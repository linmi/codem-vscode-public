package com.codem.intellij.account

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.ResolvedRuntime
import com.codem.intellij.core.RuntimeLocator
import com.codem.intellij.core.Timeouts
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.DisabledOnOs
import org.junit.jupiter.api.condition.OS
import java.nio.file.Path
import java.util.concurrent.CopyOnWriteArrayList

class AuthProcessRunnerTest {
    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun hangingCliHitsHardTimeoutAndDoesNotBlockForever() {
        val started = System.currentTimeMillis()
        var error: Throwable? = null
        try {
            JavaAuthProcessRunner().run(
                Path.of("/bin/sleep"),
                listOf("30"),
                Path.of(System.getProperty("java.io.tmpdir")),
                emptyMap(),
                400,
                1024,
            )
        } catch (thrown: Throwable) {
            error = thrown
        }
        val elapsed = System.currentTimeMillis() - started
        assertTrue(error is CodemError && error.errorClass == CodemError.Class.Authentication, error?.message)
        assertTrue(error!!.message!!.contains("timed out"), error.message)
        assertTrue(elapsed < 3_000, "auth status timeout took ${elapsed}ms")
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun successWrittenJustBeforeExitIsReadBeforeTheVerdict() {
        // 展示授权故意变慢：CLI 已退出时，读取线程还停在 login_session，login_success 仍在管道里。
        val progress = CopyOnWriteArrayList<LoginProgress>()
        scriptedLogin("printf '%s\\n%s\\n' '$SESSION' '$SUCCESS'", progress, present = { Thread.sleep(300) }).awaitSuccess()
        assertEquals(listOf(LoginProgress.AuthorizationReady, LoginProgress.Authenticated), progress)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun successWithoutTrailingNewlineIsDrained() {
        val progress = CopyOnWriteArrayList<LoginProgress>()
        scriptedLogin("printf '%s\\n%s' '$SESSION' '$SUCCESS'", progress, present = { Thread.sleep(300) }).awaitSuccess()
        assertEquals(LoginProgress.Authenticated, progress.last())
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun exitWithoutSuccessIsNotAuthenticated() {
        val error = assertThrows(CodemError.Authentication::class.java) {
            scriptedLogin("printf '%s\\n%s\\n' '$SESSION' '$BINDING'").awaitSuccess()
        }
        assertEquals("CodeM login ended without a successful authorization flow", error.message)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun stalledStdoutDrainStillHitsTheLoginDeadline() {
        // CLI 已退出，但读取线程卡在回调里到不了 EOF：等待读尽也不能越过硬截止。
        val started = System.currentTimeMillis()
        val error = assertThrows(CodemError.Authentication::class.java) {
            scriptedLogin("printf '%s\\n%s\\n' '$SESSION' '$SUCCESS'", timeoutMs = 400, present = { Thread.sleep(3_000) }).awaitSuccess()
        }
        val elapsed = System.currentTimeMillis() - started
        assertTrue(error.message!!.contains("timed out"), error.message)
        assertTrue(elapsed < 2_000, "login deadline took ${elapsed}ms")
    }

    private fun scriptedLogin(
        script: String,
        progress: MutableList<LoginProgress> = CopyOnWriteArrayList(),
        timeoutMs: Long = 5_000,
        present: (String) -> Unit = {},
    ): LoginOperation {
        val shell = object : AuthProcessRunner {
            private val real = JavaAuthProcessRunner()
            override fun run(executable: Path, arguments: List<String>, cwd: Path, environment: Map<String, String>, timeoutMs: Long, stdoutLimit: Int) =
                throw UnsupportedOperationException()
            override fun start(executable: Path, arguments: List<String>, cwd: Path, environment: Map<String, String>) =
                real.start(Path.of("/bin/sh"), listOf("-c", script), cwd, environment)
        }
        val cwd = Path.of(System.getProperty("java.io.tmpdir")).toAbsolutePath()
        return AuthClient(fakeRuntime(), cwd, timeouts = Timeouts(authLoginMs = timeoutMs), runner = shell)
            .startLogin(present) { progress += it }
    }

    private fun fakeRuntime(): ResolvedRuntime {
        val file = Path.of("/bin/sh")
        return ResolvedRuntime(RuntimeLocator.targets.values.first(), RuntimeLocator.CORE_VERSION, RuntimeLocator.CLI_VERSION, file, file, file, file, "00")
    }

    private companion object {
        const val SESSION = """{"type":"login_session","authorizationUrl":"https://login.codem.test/authorize"}"""
        const val BINDING = """{"type":"login_binding"}"""
        const val SUCCESS = """{"type":"login_success"}"""
    }
}
