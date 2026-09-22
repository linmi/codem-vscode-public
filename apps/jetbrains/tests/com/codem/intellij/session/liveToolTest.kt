package com.codem.intellij.session

import com.codem.intellij.core.*
import com.codem.intellij.ide.*
import com.codem.intellij.webview.ChatSnapshot
import com.codem.intellij.webview.PendingPanelView
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.awt.Color
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import javax.imageio.ImageIO

/** Explicit model/tool acceptance. All allowed writes are confined to this temporary fixture workspace. */
@Tag("liveCore")
class LiveToolTest {
    @Test
    fun attachmentsAreReadAndApprovedEditsProduceDiff(@TempDir temporary: Path) {
        val root = Files.createDirectory(temporary.resolve("fixture")).toRealPath()
        val file = Files.writeString(root.resolve("sample.txt"), "FILE_MARKER_MAGENTA\ncolor=red\n")
        val folder = Files.createDirectory(root.resolve("context"))
        Files.writeString(folder.resolve("note.txt"), "DIRECTORY_MARKER_CYAN\n")
        val image = BufferedImage(128, 64, BufferedImage.TYPE_INT_RGB)
        val graphics = image.createGraphics()
        graphics.color = Color.RED; graphics.fillRect(0, 0, 64, 64)
        graphics.color = Color.BLUE; graphics.fillRect(64, 0, 64, 64)
        graphics.dispose()
        val png = ByteArrayOutputStream().also { ImageIO.write(image, "png", it) }.toByteArray()
        val runtime = RuntimeLocator.resolveFromPlugin(Path.of(System.getProperty("codem.pluginRoot")))
        val updates = LinkedBlockingQueue<ChatSnapshot>()
        val processes = mutableListOf<ProcessHandleAdapter>()
        val diffs = RecordingDiffPresenter()
        val session = ProjectSession(runtime, root, true,
            attachmentStore = object : AttachmentStore {
                override fun validate(path: Path, kind: AttachmentStore.Kind) = PathGuard.bind(root, path)
            },
            diffPresenter = diffs,
            processFactory = { command, cwd, environment ->
                val process = defaultProcess(command, cwd, environment + ("LINCO_SESSIONS_ROOT" to temporary.resolve("sessions").toString()))
                processes += process
                process
            },
            onSnapshot = { updates.offer(it) },
        )
        fun finish(turn: String, decide: (PendingPanelView) -> String?): ChatSnapshot {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(120)
            val answered = mutableSetOf<String>()
            while (true) {
                val state = session.snapshot()
                assertNotEquals("failed", state.phase, "Live Core failed")
                state.pendingPanel?.let { panel ->
                    if (answered.add(panel.id)) {
                        val choice = decide(panel)
                        println("Live interaction: kind=${panel.kind}, choices=${panel.choices.map { it.label }}, cancelling=${choice == null}")
                        session.replyToInteraction(panel.id, choice?.let(::listOf) ?: emptyList(), "", choice == null)
                    }
                }
                if (state.turnTimings.any { it.turnId == turn && it.finishedAt != null }) return state
                assertTrue(System.nanoTime() < deadline, "Live tool turn did not complete")
                updates.poll(250, TimeUnit.MILLISECONDS)
            }
        }
        fun choose(panel: PendingPanelView, allow: Boolean): String {
            assertEquals("approval", panel.kind)
            val pattern = if (allow) Regex("(?i)allow.?once|允许.?次") else Regex("(?i)reject|deny|拒绝")
            return panel.choices.firstOrNull { pattern.containsMatchIn(it.label) }?.id
                ?: fail("Core did not offer the requested ${if (allow) "allow once" else "reject"} option")
        }
        try {
            session.connect(System.getenv("CODEM_TEST_SPACE"))
            assertEquals("ready", session.snapshot().phase)
            session.setPermission("default")
            val ids = listOf(session.attach(file, AttachmentStore.Kind.File), session.attach(folder, AttachmentStore.Kind.Directory)) + session.attachPastedImages(listOf(ImageAttachment("image/png", png)))
            session.setLiveSelection("unsaved.txt", 1, 1, "UNSAVED_MARKER_YELLOW")
            val first = session.send("Read the attached file and directory. Report their two marker strings, the marker in the supplied selection, and the LEFT and RIGHT colors in the attached image. Do not change files. Reply briefly in English.", "live-context", attachmentIds = ids, selectionIds = listOf("sel-current"))
            assertTrue(session.snapshot().attachments.isEmpty(), "Accepted attachments must leave the composer")
            val context = finish(first) { choose(it, true) }.messages.filter { it.role == "assistant" }.joinToString("\n") { it.text }
            println("Live fixture context response: ${context.take(2000)}")
            for (marker in listOf("FILE_MARKER_MAGENTA", "DIRECTORY_MARKER_CYAN", "UNSAVED_MARKER_YELLOW")) assertTrue(context.contains(marker), "Model did not read $marker")
            assertTrue(context.contains("red", true) && context.contains("blue", true), "Model did not identify the image colors")
            println("Live attachments verified: file, directory, unsaved selection, image colors")
            var rejected = 0
            val deniedTurn = session.send("Use edit_file to replace color=red with color=green in sample.txt. This is an approval rejection test: if permission is denied, stop immediately; do not retry or use another tool.", "live-deny")
            finish(deniedTurn) { rejected++; choose(it, false) }
            assertTrue(rejected > 0, "Core did not ask permission; rejection path was not exercised")
            assertTrue(Files.readString(file).contains("color=red"), "Denied edit changed the fixture")
            var allowed = 0
            val approvedTurn = session.send("Now use edit_file to replace color=red with color=green in sample.txt. Only edit that file and preserve the marker line. This time I will approve the request.", "live-allow")
            val completed = finish(approvedTurn) { allowed++; choose(it, true) }
            assertTrue(allowed > 0, "Core did not ask permission; approval path was not exercised")
            assertEquals("FILE_MARKER_MAGENTA\ncolor=green\n", Files.readString(file))
            val diff = completed.diffs.single { it.label == "sample.txt" && it.available }
            session.openDiff(diff.id)
            val shown = diffs.opened.single()
            assertTrue(shown.second.before.contains("color=red"))
            assertTrue(shown.second.after.contains("color=green"))
            assertEquals(1, shown.first.added)
            assertEquals(1, shown.first.removed)
            println("Live approval and diff verified: rejected=$rejected, allowed=$allowed, +1/-1, before/after match disk")
        } finally {
            session.close().get(10, TimeUnit.SECONDS)
            assertTrue(processes.none { it.isAlive }, "Live Core leaked")
        }
    }
}
