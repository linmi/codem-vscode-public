package com.codem.intellij.history

import com.codem.intellij.core.CodemError
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

class HistoryReplayTest {
    @Test
    fun replaysUserBoundariesAndHidesSyntheticInput(@TempDir root: Path) {
        val cwd = "/workspace"
        val thread = "thread-1"
        write(root, cwd, thread, fixture("multiTurn.jsonl").replace("\${cwd}", cwd) + "\n")
        val page = HistoryReplay.read(root, cwd, thread)
        assertEquals(listOf("s0", "s1"), page.turns.map { it.submissionId })
        assertEquals(listOf("question 0"), page.turns[0].userTexts)
        assertEquals("FIRST LINE\n\nLAST LINE", page.turns[0].assistantTexts.single())
        assertTrue(page.turns.none { turn -> turn.userTexts.contains("hidden reminder") })
    }

    @Test
    fun ignoresTrailingFragmentAndRejectsACompleteBadLine(@TempDir root: Path) {
        val cwd = "/workspace"
        write(root, cwd, "thread-1", fixture("trailingFragment.jsonl").replace("\${cwd}", cwd))
        assertEquals(1, HistoryReplay.read(root, cwd, "thread-1").turns.size)
        write(root, cwd, "thread-1", fixture("badCompleteLine.jsonl").replace("\${cwd}", cwd) + "\n")
        var failed = false
        try {
            HistoryReplay.read(root, cwd, "thread-1")
        } catch (error: CodemError) {
            failed = error.errorClass == CodemError.Class.History
        }
        assertTrue(failed)
    }

    /**
     * 与 Node 读取一致：rewind_mark 是检查点控制元数据，轮次保留；
     * 会话回退由 Core 物理截断文件表达。cleared 才是重放截断点。
     */
    @Test
    fun rewindMarkKeepsTurnsAndClearedTruncates(@TempDir root: Path) {
        val cwd = "/workspace"
        val base = fixture("multiTurn.jsonl").replace("\${cwd}", cwd).trimEnd('\n')
        val marked = base + "\n" +
            """{"type":"rewind_mark","at":"2026-09-16T00:00:00Z","checkpoint_id":"cp-1","mode":"conversation","record_seq":13}""" + "\n"
        write(root, cwd, "thread-1", marked)
        assertEquals(listOf("s0", "s1"), HistoryReplay.read(root, cwd, "thread-1").turns.map { it.submissionId })

        write(root, cwd, "thread-1", marked + """{"type":"cleared","record_seq":14}""" + "\n")
        assertEquals(0, HistoryReplay.read(root, cwd, "thread-1").turns.size)

        write(root, cwd, "thread-1", base + "\n" + """{"type":"rewind_mark","at":"2026-09-16T00:00:00Z","mode":"conversation","record_seq":13}""" + "\n")
        var failed = false
        try {
            HistoryReplay.read(root, cwd, "thread-1")
        } catch (error: CodemError) {
            failed = error.errorClass == CodemError.Class.History
        }
        assertTrue(failed)
    }

    @Test
    fun rejectsIdentityMismatch(@TempDir root: Path) {
        val cwd = "/workspace"
        write(root, cwd, "other-thread", fixture("multiTurn.jsonl").replace("\${cwd}", cwd) + "\n")
        var failed = false
        try {
            HistoryReplay.read(root, cwd, "other-thread")
        } catch (error: CodemError) {
            failed = error.message?.contains("does not match") == true
        }
        assertTrue(failed)
    }

    @Test
    fun resolvesSessionsRootInCoreOrder() {
        val home = Path.of("/tmp/codem-home-fixture")
        assertEquals(Path.of("/tmp/sessions"), SessionsRoot.resolve(mapOf("LINCO_SESSIONS_ROOT" to "/tmp/sessions"), home))
        assertEquals(home.resolve("sessions"), SessionsRoot.resolve(mapOf("LINCO_HOME" to home.toString()), home))
        assertEquals(home.resolve(".codem").resolve("sessions"), SessionsRoot.resolve(emptyMap(), home))
    }

    @Test
    fun rejectsMalformedVisibleTextInsteadOfRenderingEmpty(@TempDir root: Path) {
        val base = fixture("multiTurn.jsonl").replace("\${cwd}", "/workspace") + "\n"
        for (bad in listOf("42", "null", "true", "{}", "[]", "\"\"", "\"   \"")) {
            write(root, "/workspace", "thread-1", base.replace("\"text\":\"answer 1\"", "\"text\":$bad"))
            val error = org.junit.jupiter.api.Assertions.assertThrows(CodemError.History::class.java) {
                HistoryReplay.read(root, "/workspace", "thread-1")
            }
            assertTrue(error.message!!.contains("assistant_text.text"))
        }
        for ((original, replacement) in listOf(
            "\"text\":\"answer 1\"" to "\"missing\":true",
            "\"content\":\"question 0\"" to "\"content\":42",
            "\"submission_id\":\"s0\"" to "\"submission_id\":42",
            "\"record_seq\":2" to "\"record_seq\":2.5",
            "\"schema_version\":13" to "\"schema_version\":13.5",
        )) {
            write(root, "/workspace", "thread-1", base.replace(original, replacement))
            org.junit.jupiter.api.Assertions.assertThrows(CodemError.History::class.java) {
                HistoryReplay.read(root, "/workspace", "thread-1")
            }
        }
    }

    @Test
    fun rendersSkillInvocationWithoutInventingEmptyMessage(@TempDir root: Path) {
        val base = fixture("multiTurn.jsonl").replace("\${cwd}", "/workspace") + "\n"
        write(root, "/workspace", "thread-1", base.replace(
            "\"kind\":\"message\",\"content\":\"question 0\"",
            "\"kind\":\"skill\",\"name\":\"review\",\"arguments\":\"working tree\"",
        ))
        assertEquals(listOf("/review working tree"), HistoryReplay.read(root, "/workspace", "thread-1").turns.first().userTexts)
    }

    private fun write(root: Path, cwd: String, threadId: String, body: String) {
        val directory = root.resolve(ProjectHash.forCwd(cwd))
        Files.createDirectories(directory)
        Files.writeString(directory.resolve("$threadId.jsonl"), body)
    }

    private fun fixture(name: String): String {
        val candidates = listOf(
            Path.of("packages/contracts/history", name),
            Path.of("../../packages/contracts/history", name),
            Path.of(System.getProperty("codem.contractsHistory", "packages/contracts/history"), name),
        )
        val path = candidates.first { Files.isRegularFile(it) }
        return Files.readString(path)
    }
}
