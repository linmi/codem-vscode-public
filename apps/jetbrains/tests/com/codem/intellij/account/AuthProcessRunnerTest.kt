package com.codem.intellij.account

import com.codem.intellij.core.CodemError
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.DisabledOnOs
import org.junit.jupiter.api.condition.OS
import java.nio.file.Path

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
}
