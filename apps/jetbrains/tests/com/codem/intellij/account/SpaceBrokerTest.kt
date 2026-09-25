package com.codem.intellij.account

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue
import com.codem.intellij.core.ResolvedRuntime
import com.codem.intellij.core.RuntimeLocator
import com.codem.intellij.core.Timeouts
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.DisabledOnOs
import org.junit.jupiter.api.condition.OS
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import java.nio.file.Path
import java.util.concurrent.CopyOnWriteArrayList

class SpaceBrokerTest {
    @Test
    fun managedDirectoryAcceptsWindowsAndUnixAbsolutePaths() {
        assertTrue(isAbsoluteManagedDirectory("/tmp/managed"))
        assertTrue(isAbsoluteManagedDirectory("C:\\Users\\codem\\managed"))
        assertTrue(isAbsoluteManagedDirectory("D:/data/managed"))
        assertTrue(isAbsoluteManagedDirectory("\\\\server\\share\\managed"))
        assertEquals(false, isAbsoluteManagedDirectory("relative/path"))
        assertEquals(false, isAbsoluteManagedDirectory("C:relative"))
        assertEquals(false, isAbsoluteManagedDirectory("managed\u0000dir"))
    }

    @Test
    fun parsePreparedRejectsRelativeManagedDirectory() {
        val payload = JsonValue.obj(
            "project_key" to JsonValue.Text("proj_a"),
            "project_name" to JsonValue.Text("Space A"),
            "status" to JsonValue.Text("ok"),
            "managed_dir" to JsonValue.Text("relative/path"),
        )
        var failed = false
        try {
            parsePrepared(payload, "proj_a")
        } catch (error: CodemError) {
            failed = error.errorClass == CodemError.Class.Validation
        }
        assertTrue(failed)
        val windows = parsePrepared(
            JsonValue.obj(
                "project_key" to JsonValue.Text("proj_a"),
                "project_name" to JsonValue.Text("Space A"),
                "status" to JsonValue.Text("ok"),
                "managed_dir" to JsonValue.Text("C:\\Users\\codem\\space"),
            ),
            "proj_a",
        )
        assertEquals("C:\\Users\\codem\\space", windows.managedDirectory)
        val launched = object : SpaceGateway {
            override fun prepareInitial(requestedKey: String?) = throw UnsupportedOperationException()
            override fun prepare(projectKey: String) = windows
            override fun launchArguments(space: PreparedSpace) =
                listOf("--project-key", space.projectKey) to mapOf("CODEM_MANAGED_DIR" to space.managedDirectory!!)
        }.launchArguments(windows)
        assertEquals("C:\\Users\\codem\\space", launched.second["CODEM_MANAGED_DIR"])
    }

    /** 与 spaces.ts 相同：项目表必须是数组，space_prepare 必须回显所请求的 key 与 ok/empty 状态，否则以 Validation 失败。 */
    @Test
    fun spacePayloadsFailClosedOnMissingOrMistypedFields() {
        val prepared = JsonValue.obj(
            "project_key" to JsonValue.Text("proj_a"),
            "project_name" to JsonValue.Text("Space A"),
            "status" to JsonValue.Text("empty"),
        )
        assertEquals("proj_a", parsePrepared(prepared, "proj_a").projectKey)
        val invalid = listOf(
            "project_key" to JsonValue.Text("proj_b"),
            "project_key" to JsonValue.NumberValue(1.0, "1"),
            "project_key" to null,
            "status" to JsonValue.Text("failed"),
            "status" to JsonValue.Bool(true),
            "status" to null,
        )
        for ((key, value) in invalid) {
            val payload = JsonValue.ObjectValue(if (value == null) prepared.fields - key else prepared.fields + (key to value))
            val error = assertThrows(CodemError::class.java, { parsePrepared(payload, "proj_a") }, "$key=$value")
            assertEquals(CodemError.Class.Validation, error.errorClass, "$key=$value")
        }
        assertEquals(emptyList<Space>(), parseSpaces(JsonValue.obj("projects" to JsonValue.ArrayValue(emptyList()))).spaces)
        for (projects in listOf(null, JsonValue.Null, JsonValue.obj())) {
            val payload = if (projects == null) JsonValue.obj() else JsonValue.obj("projects" to projects)
            val error = assertThrows(CodemError::class.java, { parseSpaces(payload) }, "projects=$projects")
            assertEquals(CodemError.Class.Validation, error.errorClass, "projects=$projects")
        }
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun unexpectedNotificationFailsThePendingRequestWithoutKillingTheReader() {
        // 默认处理器是全局的：同一 JVM 里其他测试遗留的线程也可能在这段时间抛出，只认 broker 读线程自己的异常。
        val uncaught = CopyOnWriteArrayList<Pair<String, Throwable>>()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error -> uncaught += thread.name to error }
        try {
            // 脚本 broker 收到 initialize 后只回一条通知，然后一直等 stdin 关闭。
            val script = """read line; printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/message","params":{}}'; exec cat >/dev/null"""
            val broker = SpaceBroker(
                runtime(),
                Path.of(System.getProperty("java.io.tmpdir")).toAbsolutePath(),
                timeouts = Timeouts(spaceBrokerMs = 10_000),
                openPeer = { _, cwd, environment -> javaBrokerSession(listOf("/bin/sh", "-c", script), cwd, environment) },
            )
            val started = System.currentTimeMillis()
            val error = assertThrows(CodemError.Authentication::class.java) { broker.list() }
            val elapsed = System.currentTimeMillis() - started
            assertEquals("CodeM space broker sent an unexpected notification", error.cause?.cause?.message, error.toString())
            assertTrue(elapsed < 3_000, "broker request took ${elapsed}ms to fail")
            val deadline = System.currentTimeMillis() + 3_000
            while (Thread.getAllStackTraces().keys.any { it.name == "codem-space-broker" } && System.currentTimeMillis() < deadline) Thread.sleep(10)
            val readerFailures = uncaught.filter { (name, _) -> name == "codem-space-broker" }
            assertEquals(emptyList<Pair<String, Throwable>>(), readerFailures, "broker reader died: ${readerFailures.map { it.second.stackTraceToString() }}")
        } finally {
            Thread.setDefaultUncaughtExceptionHandler(previous)
        }
    }

    @ParameterizedTest
    @ValueSource(
        strings = [
            // 读到 initialize 后直接退出。
            "read line; exit 0",
            // 关闭 stdout 但进程仍在，等 stdin 关闭：失败必须由 EOF 触发，不靠进程退出。
            "read line; exec >&-; exec cat >/dev/null",
        ],
    )
    @DisabledOnOs(OS.WINDOWS)
    fun brokerClosingStdoutWithoutAnsweringFailsThePendingRequestImmediately(script: String) {
        val broker = SpaceBroker(
            runtime(),
            Path.of(System.getProperty("java.io.tmpdir")).toAbsolutePath(),
            timeouts = Timeouts(spaceBrokerMs = 10_000),
            openPeer = { _, cwd, environment -> javaBrokerSession(listOf("/bin/sh", "-c", script), cwd, environment) },
        )
        val started = System.currentTimeMillis()
        val error = assertThrows(CodemError.Authentication::class.java) { broker.list() }
        val elapsed = System.currentTimeMillis() - started
        assertEquals("CodeM App Server closed stdout unexpectedly", error.cause?.cause?.message, error.cause.toString())
        assertTrue(elapsed < 1_000, "broker request took ${elapsed}ms to fail after stdout closed")
    }

    private fun runtime(): ResolvedRuntime {
        val file = Path.of("/bin/sh")
        return ResolvedRuntime(RuntimeLocator.targets.values.first(), RuntimeLocator.CORE_VERSION, RuntimeLocator.CLI_VERSION, file, file, file, file, "00")
    }
}
