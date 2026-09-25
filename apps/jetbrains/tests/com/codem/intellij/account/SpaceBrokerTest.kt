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

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun unexpectedNotificationFailsThePendingRequestWithoutKillingTheReader() {
        val uncaught = CopyOnWriteArrayList<Throwable>()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { _, error -> uncaught += error }
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
            assertEquals(emptyList<Throwable>(), uncaught)
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
