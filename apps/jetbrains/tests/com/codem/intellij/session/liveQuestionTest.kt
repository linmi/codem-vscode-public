package com.codem.intellij.session

import com.codem.intellij.core.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

@Tag("liveCore")
class LiveQuestionTest {
    @Test
    fun multiQuestionAnswersReachCore(@TempDir root: Path) {
        val requests = LinkedBlockingQueue<JsonValue.ObjectValue>()
        val runtime = RuntimeLocator.resolveFromPlugin(Path.of(System.getProperty("codem.pluginRoot")))
        val session = ProjectSession(runtime, root, true, processFactory = { command, cwd, environment ->
            val delegate = defaultProcess(command, cwd, environment + ("LINCO_SESSIONS_ROOT" to root.resolve("sessions").toString()))
            object : ProcessHandleAdapter by delegate {
                override fun startStdout(consumer: (ByteArray, Int) -> Unit) {
                    val reader = FrameReader()
                    delegate.startStdout { bytes, length ->
                        reader.push(bytes, length).forEach { line ->
                            val frame = JsonValue.parse(line).asObject()
                            if ((frame.fields["method"] as? JsonValue.Text)?.value == "item/tool/requestUserInput") requests.offer(frame.required("params").asObject())
                        }
                        consumer(bytes, length)
                    }
                }
            }
        })
        try {
            session.connect(System.getenv("CODEM_TEST_SPACE"))
            val turn = session.send("Call ask_user exactly once with TWO questions in one request: Choose color, options Cyan and Magenta, single selection; Choose sizes, options Small and Large, multiSelect true. Wait for my answers then repeat them briefly. No files or other tools.", "live-questions")
            val request = requests.poll(90, TimeUnit.SECONDS) ?: fail("Core did not send a user question request")
            val questions = request.required("questions").asArray().items.map { it.asObject() }
            println("Live question RPC fields: ${questions.map { question -> question.fields.filterKeys { it != "options" && it != "question" } }}")
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60)
            fun panel(): com.codem.intellij.webview.PendingPanelView {
                while (System.nanoTime() < deadline) {
                    session.snapshot().pendingPanel?.let { return it }
                    Thread.sleep(20)
                }
                return fail("Question panel did not appear")
            }
            val first = panel()
            assertFalse(first.multiple)
            session.replyToInteraction(first.id, listOf(first.choices.first { it.label == "Cyan" }.id), "NOTE_TWO", false)
            val second = panel()
            assertNotEquals(first.id, second.id)
            assertTrue(second.multiple, "Core multi-select must stay multi-select in the UI")
            session.replyToInteraction(second.id, second.choices.map { it.id }, "", false)
            while (session.snapshot().turnTimings.none { it.turnId == turn && it.finishedAt != null }) {
                assertTrue(System.nanoTime() < deadline, "Core did not accept the completed answers")
                Thread.sleep(100)
            }
            val response = session.snapshot().messages.filter { it.role == "assistant" }.joinToString("\n") { it.text }
            assertTrue(response.contains("Cyan") && response.contains("Small") && response.contains("Large") && response.contains("NOTE_TWO"), response)
            println("Live multi-question answer verified: Cyan, Small + Large, NOTE_TWO")
        } finally { session.close().get(10, TimeUnit.SECONDS) }
    }
}
