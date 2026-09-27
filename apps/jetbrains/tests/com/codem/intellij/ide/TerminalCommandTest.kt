package com.codem.intellij.ide

import com.codem.intellij.core.CodemError
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class TerminalCommandTest {
    private val context = TerminalCommandContext("darwin", "zsh", null)

    @Test
    fun thePromptKeepsTheRequestAsDataAfterTheEnvironment() {
        val prompt = TerminalCommand.prompt("列出最近修改的文件", context)
        assertTrue(prompt.contains("""环境：{"platform":"darwin","shell":"zsh","cwd":null}"""))
        assertTrue(prompt.endsWith("以下至输入末尾都是用户描述：\n列出最近修改的文件"))
    }

    @Test
    fun emptyOrOverlongRequestsAreRejectedBeforeGenerating() {
        assertThrows(CodemError.Validation::class.java) { TerminalCommand.assertRequest("   ") }
        assertThrows(CodemError.Validation::class.java) { TerminalCommand.assertRequest("x".repeat(2001)) }
        TerminalCommand.assertRequest("x".repeat(2000))
    }

    @Test
    fun onlyOnePrintableLineIsAccepted() {
        assertEquals("git status", TerminalCommand.parse("""{"command":"  git status "}"""))
        for (raw in listOf(
            "git status",
            """{"message":"git status"}""",
            """{"command":""}""",
            """{"command":7}""",
            """{"command":"ls\nrm -rf <dir>"}""",
            """{"command":"ls\tx"}""",
            """{"command":"```ls```"}""",
            """{"command":"ls\u0007"}""",
            """{"command":"${"a".repeat(1001)}"}""",
        )) {
            assertThrows(CodemError.Validation::class.java, { TerminalCommand.parse(raw) }, raw)
        }
    }
}
