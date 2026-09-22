package com.codem.intellij.session

import com.codem.intellij.core.ProcessHandleAdapter
import com.codem.intellij.core.RuntimeLocator
import com.codem.intellij.core.defaultProcess
import com.codem.intellij.history.HistoryReplay
import com.codem.intellij.ide.HistorySource
import com.codem.intellij.webview.ChatSnapshot
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Opt-in only: uses the existing account and current space; never signs in or changes either. */
@Tag("liveCore")
class LiveSessionTest {
    @Test
    fun sendCloseRestoreAndContinue(@TempDir temporary: Path) {
        val workspace = Files.createDirectories(temporary.resolve("IDEA live 工作区")).toRealPath()
        val sessions = Files.createDirectories(temporary.resolve("sessions")).toRealPath()
        val runtime = RuntimeLocator.resolveFromPlugin(Path.of(System.getProperty("codem.pluginRoot")))
        val processes = mutableListOf<ProcessHandleAdapter>()
        val updates = LinkedBlockingQueue<ChatSnapshot>()
        fun newSession() = ProjectSession(
            runtime, workspace, trusted = true,
            processFactory = { command, cwd, environment ->
                defaultProcess(command, cwd, environment + ("LINCO_SESSIONS_ROOT" to sessions.toString()))
                    .also { processes.add(it) }
            },
            historySource = HistorySource { cwd, threadId, cursor -> HistoryReplay.read(sessions, cwd, threadId, cursor = cursor) },
            onSnapshot = { updates.offer(it) },
        )
        fun connect(session: ProjectSession) {
            val started = System.nanoTime()
            session.connect(System.getenv("CODEM_TEST_SPACE"))
            assertEquals("ready", session.snapshot().phase, "Live test requires a signed-in account and a selected space")
            for (key in listOf("auth", "list", "prepare", "core")) assertEquals(1, session.callBudget()[key], key)
            println("Live connection ready in ${(System.nanoTime() - started) / 1_000_000}ms; budget=${session.callBudget()}")
        }
        fun send(session: ProjectSession, marker: String, requestId: String): String {
            updates.clear()
            val started = System.nanoTime()
            val turnId = session.send("Reply exactly $marker. Do not use tools or read/write files.", requestId)
            assertEquals(requestId, session.snapshot().submission?.requestId)
            assertEquals(true, session.snapshot().submission?.accepted)
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(90)
            while (true) {
                val snapshot = session.snapshot()
                assertNotEquals("failed", snapshot.phase, "Core failed during live turn")
                assertNull(snapshot.pendingPanel, "Text-only live probe unexpectedly requested interaction")
                if (snapshot.turnTimings.any { it.turnId == turnId && it.finishedAt != null }) {
                    assertEquals("ready", snapshot.phase)
                    assertTrue(snapshot.messages.any { it.role == "assistant" && it.text.contains(marker) }, "Completed turn did not contain the expected reply")
                    println("Live turn completed in ${(System.nanoTime() - started) / 1_000_000}ms; terminal=turn/completed")
                    return snapshot.threadId!!
                }
                assertTrue(System.nanoTime() < deadline, "Timed out waiting for turn/completed")
                updates.poll(250, TimeUnit.MILLISECONDS)
            }
        }
        fun close(session: ProjectSession) {
            session.close().get(10, TimeUnit.SECONDS)
            assertTrue(processes.none { it.isAlive }, "Live Core process leaked after close")
        }
        val first = newSession()
        val threadId: String
        try {
            connect(first)
            threadId = send(first, "CODEM_IDEA_LIVE_OK", "idea-live-first")
            first.newChat()
            assertNull(first.snapshot().threadId)
            first.showHistory()
            assertTrue(first.snapshot().history.entries.any { it.id == threadId })
            assertEquals(threadId, first.resumeThread(threadId))
            assertFalse(first.snapshot().history.open)
        } finally {
            close(first)
        }
        val persisted = HistoryReplay.read(sessions, workspace.toString(), threadId)
        assertEquals(1, persisted.turns.size)
        assertTrue(persisted.turns.single().assistantTexts.any { it.contains("CODEM_IDEA_LIVE_OK") })
        val resumed = newSession()
        try {
            connect(resumed)
            assertEquals(threadId, resumed.resumeThread(threadId))
            val messages = resumed.snapshot().messages
            assertEquals(1, messages.count { it.role == "user" })
            assertTrue(messages.any { it.role == "assistant" && it.text.contains("CODEM_IDEA_LIVE_OK") })
            assertEquals(threadId, send(resumed, "CODEM_IDEA_RESUMED_OK", "idea-live-second"))
        } finally {
            close(resumed)
        }
        val finalHistory = HistoryReplay.read(sessions, workspace.toString(), threadId)
        assertEquals(2, finalHistory.turns.size)
        assertEquals(2, finalHistory.turns.sumOf { it.userTexts.size })
        assertTrue(finalHistory.turns.flatMap { it.assistantTexts }.any { it.contains("CODEM_IDEA_RESUMED_OK") })
        println("Live history verified: 2 turns, same thread, 2 Core processes closed; temporary history only")
    }
}
