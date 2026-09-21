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
