package com.codem.intellij.session

import com.codem.intellij.account.AuthGateway
import com.codem.intellij.account.AuthStatus
import com.codem.intellij.account.PreparedSpace
import com.codem.intellij.account.Space
import com.codem.intellij.account.SpaceGateway
import com.codem.intellij.account.SpaceList
import com.codem.intellij.account.SpacePreparation
import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue
import com.codem.intellij.core.ResolvedRuntime
import com.codem.intellij.core.RuntimeLocator
import com.codem.intellij.core.ScriptedProcess
import com.codem.intellij.core.Timeouts
import com.codem.intellij.core.encodeJson
import com.codem.intellij.history.HistoryPage
import com.codem.intellij.history.HistoryTurn
import com.codem.intellij.ide.AttachmentStore
import com.codem.intellij.ide.DirectoryPicker
import com.codem.intellij.ide.HistorySource
import com.codem.intellij.ide.RecordingDiffPresenter
import com.codem.intellij.ide.SelectionReader
import com.codem.intellij.ide.SelectionSnapshot
import com.codem.intellij.webview.ViewAction
import com.codem.intellij.webview.initialSnapshot
import com.codem.intellij.webview.parseViewAction
import com.codem.intellij.webview.visibleControls
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicInteger

class ProjectSessionTest {
    @Test
    fun reconnectRecyclesPreviousCoreAndSendUsesNodeShape() {
        val processes = mutableListOf<ScriptedProcess>()
        val capabilities = handshakeCapabilities()
        val session = session { process ->
            processes.add(process)
            startResponder(process, capabilities)
            process
        }
        session.connect()
        assertEquals(1, processes.size)
        assertTrue(processes[0].isAlive)
        assertEquals("ready", session.snapshot().phase)
        session.connect()
        assertEquals(2, processes.size)
        assertTrue(!processes[0].isAlive)
        assertTrue(processes[1].isAlive)
        val turnId = session.send("hello world", "req-1")
        assertEquals("turn-1", turnId)
        val turnStart = processes[1].writes.map { JsonValue.parse(it).asObject() }
            .first { (it.fields["method"] as? JsonValue.Text)?.value == "turn/start" }
            .required("params").asObject()
        assertEquals("thread-1", turnStart.required("threadId").asText())
        assertEquals("req-1", turnStart.required("clientUserMessageId").asText())
        val input = turnStart.required("input").asArray().items.single().asObject()
        assertEquals("text", input.required("type").asText())
        assertEquals("hello world", input.required("text").asText())
        assertEquals(emptyList<JsonValue>(), input.required("textElements").asArray().items)
    }

    @Test
    fun newChatStopsRunningTurnBeforeClearingThreadId() {
        val process = ScriptedProcess()
        val interrupted = java.util.concurrent.CountDownLatch(1)
        val session = session {
            startResponder(process, handshakeCapabilities(), beforeReply = { if (it == "turn/interrupt") interrupted.countDown() })
            process
        }
        session.connect()
        session.send("hello", "req-1")
        assertEquals("thread-1", session.snapshot().threadId)
        val changed = java.util.concurrent.CompletableFuture.runAsync { session.newChat() }
        awaitSnapshot(session) { it.phase == "stopping" }
        assertEquals("thread-1", session.snapshot().threadId)
        assertTrue(!changed.isDone)
        org.junit.jupiter.api.Assertions.assertThrows(CodemError.Conflict::class.java) { session.send("too early", "req-early") }
        assertTrue(interrupted.await(2, java.util.concurrent.TimeUnit.SECONDS))
        completeTurn(process, "thread-1", "turn-1")
        changed.get(5, java.util.concurrent.TimeUnit.SECONDS)
        val methods = process.writes.map { JsonValue.parse(it).asObject() }
            .mapNotNull { (it.fields["method"] as? JsonValue.Text)?.value }
        assertTrue(methods.contains("turn/interrupt"))
        assertTrue(methods.indexOf("thread/unsubscribe") > methods.indexOf("turn/interrupt"))
        val interrupt = process.writes.map { JsonValue.parse(it).asObject() }
            .first { (it.fields["method"] as? JsonValue.Text)?.value == "turn/interrupt" }
            .required("params").asObject()
        assertEquals("thread-1", interrupt.required("threadId").asText())
        assertEquals("turn-1", interrupt.required("turnId").asText())
        val after = session.snapshot()
        assertEquals(null, after.threadId)
        assertEquals("thread-1", after.resumeThreadId)
        assertEquals(true, after.canResume)
        assertEquals(true, visibleControls(after).resume)
        assertEquals(false, visibleControls(after).older)
        session.close().join()
    }

    @Test
    fun newChatReleasesSubscriptionAndRepeatedResumeReleasesBeforeLoading() {
        val process = ScriptedProcess()
        val session = session { startResponder(process, handshakeCapabilities()); process }
        try {
            session.connect()
            session.resumeThread("thread-1")
            session.newChat()
            session.newChat()
            session.resumeThread("thread-1")
            session.resumeThread("thread-1")
            val methods = process.writes.map { JsonValue.parse(it).asObject() }
                .mapNotNull { (it.fields["method"] as? JsonValue.Text)?.value }
                .filter { it == "thread/resume" || it == "thread/unsubscribe" }
            assertEquals(listOf("thread/resume", "thread/unsubscribe", "thread/resume", "thread/unsubscribe", "thread/resume"), methods)
            assertEquals("thread-1", session.snapshot().threadId)
            assertEquals("ready", session.snapshot().phase)
        } finally { session.close().join() }
    }

    @Test
    fun failedUnsubscribeKeepsCurrentThreadAndDoesNotAttemptResume() {
        val process = ScriptedProcess()
        val session = session { startResponder(process, handshakeCapabilities(), failMethod = "thread/unsubscribe"); process }
        try {
            session.connect()
            session.resumeThread("thread-1")
            org.junit.jupiter.api.Assertions.assertThrows(Exception::class.java) { session.resumeThread("thread-2") }
            assertEquals("thread-1", session.snapshot().threadId)
            assertEquals("ready", session.snapshot().phase)
            val resumes = process.writes.map { JsonValue.parse(it).asObject() }
                .count { (it.fields["method"] as? JsonValue.Text)?.value == "thread/resume" }
            assertEquals(1, resumes)
        } finally { session.close().join() }
    }

    @Test
    fun completionBeforeInterruptDoesNotSendAnInvalidStop() {
        val process = ScriptedProcess()
        val completeOnce = java.util.concurrent.atomic.AtomicBoolean(false)
        lateinit var current: ProjectSession
        current = session(onSnapshot = { snapshot ->
            if (snapshot.phase == "stopping" && completeOnce.compareAndSet(false, true)) {
                completeTurn(process, "thread-1", "turn-1")
                awaitSnapshot(current) { it.turnTimings.any { timing -> timing.finishedAt != null } }
            }
        }) { startResponder(process, handshakeCapabilities()); process }
        try {
            current.connect()
            current.send("hello", "req-finish-first")
            current.newChat()
            assertEquals(null, current.snapshot().threadId)
            assertTrue(process.writes.none { it.contains("turn/interrupt") })
            assertTrue(process.writes.any { it.contains("thread/unsubscribe") })
        } finally { current.close().join() }
    }

    @Test
    fun obsoleteEmptyUnsubscribeResponseCannotClearTheThread() {
        val process = ScriptedProcess()
        val session = session { startResponder(process, handshakeCapabilities(), emptyUnsubscribe = true); process }
        try {
            session.connect()
            session.resumeThread("thread-1")
            org.junit.jupiter.api.Assertions.assertThrows(CodemError.Protocol::class.java) { session.newChat() }
            assertEquals("thread-1", session.snapshot().threadId)
            assertEquals("ready", session.snapshot().phase)
        } finally { session.close().join() }
    }

    @Test
    fun missingTerminalKeepsTheThreadAndAllowsRetryAfterCompletion() {
        val process = ScriptedProcess()
        val session = session { startResponder(process, handshakeCapabilities()); process }
        try {
            session.connect()
            session.send("hello", "req-timeout")
            org.junit.jupiter.api.Assertions.assertThrows(CodemError.Conflict::class.java) { session.newChat() }
            assertEquals("thread-1", session.snapshot().threadId)
            assertTrue(process.writes.none { it.contains("thread/unsubscribe") })
            completeTurn(process, "thread-1", "turn-1")
            awaitSnapshot(session) { it.phase == "ready" }
            session.newChat()
            assertEquals(null, session.snapshot().threadId)
        } finally { session.close().join() }
    }

    @Test
    fun retiredThreadEventsCannotClearTheNewSubscription() {
        val process = ScriptedProcess()
        val session = session { startResponder(process, handshakeCapabilities()); process }
        try {
            session.connect()
            session.resumeThread("thread-old")
            session.resumeThread("thread-new")
            val before = session.snapshot().version
            process.enqueue(encodeJson(JsonValue.obj(
                "jsonrpc" to JsonValue.Text("2.0"),
                "method" to JsonValue.Text("thread/closed"),
                "params" to JsonValue.obj("threadId" to JsonValue.Text("thread-old")),
            )))
            val after = awaitSnapshot(session) { it.version > before }
            assertEquals("thread-new", after.threadId)
        } finally { session.close().join() }
    }

    @Test
    fun closingWhileNewChatWaitsForTerminalRevokesTheSwitch() {
        val process = ScriptedProcess()
        val session = session { startResponder(process, handshakeCapabilities()); process }
        session.connect()
        session.send("hello", "req-close")
        val change = java.util.concurrent.CompletableFuture.runAsync { session.newChat() }
        awaitSnapshot(session) { it.phase == "stopping" }
        session.close().join()
        org.junit.jupiter.api.Assertions.assertThrows(java.util.concurrent.ExecutionException::class.java) {
            change.get(5, java.util.concurrent.TimeUnit.SECONDS)
        }
        assertEquals("disconnected", session.snapshot().phase)
        assertTrue(process.writes.none { it.contains("thread/unsubscribe") })
    }

    @Test
    fun untrustedSessionRejectsConnectAndSend() {
        val session = session(trusted = false) { ScriptedProcess() }
        var connectFailed = false
        try {
            session.connect()
        } catch (error: CodemError) {
            connectFailed = error.errorClass == CodemError.Class.Validation
        }
        var sendFailed = false
        try {
            session.send("hello", "req-1")
        } catch (error: CodemError) {
            sendFailed = error.errorClass == CodemError.Class.Validation
        }
        assertTrue(connectFailed)
        assertTrue(sendFailed)
        assertEquals("disconnected", session.snapshot().phase)
        assertEquals(false, session.snapshot().canRetry)
    }

    @Test
    fun failedPhaseAllowsRetryWhileHostSilenceDoesNot() {
        assertEquals("disconnected", initialSnapshot().phase)
        assertEquals(false, initialSnapshot().canRetry)
        val process = ScriptedProcess(crashAfterWrites = 1)
        val session = session { process }
        try {
            session.connect()
        } catch (_: Exception) {
        }
        val snapshot = session.snapshot()
        assertEquals("failed", snapshot.phase)
        assertEquals(true, snapshot.canRetry)
        assertEquals("CodeM connection failed", snapshot.notice)
        assertEquals(false, SafeNotice.containsSensitive(snapshot.notice ?: ""))
    }

    @Test
    fun resumeAndClearUseNodeRequestShapes() {
        val process = ScriptedProcess()
        val session = session { startResponder(process, handshakeCapabilities()); process }
        session.connect()
        assertEquals("thread-1", session.resumeThread("thread-1"))
        val clearId = session.clearThread("op-1")
        assertEquals("thread-new", clearId)
        val writes = process.writes.map { JsonValue.parse(it).asObject() }
        val resume = writes.first { (it.fields["method"] as? JsonValue.Text)?.value == "thread/resume" }.required("params").asObject()
        assertEquals("thread-1", resume.required("threadId").asText())
        assertTrue(resume.fields.containsKey("cwd"))
        val clear = writes.first { (it.fields["method"] as? JsonValue.Text)?.value == "thread/clear" }.required("params").asObject()
        assertEquals("op-1", clear.required("operationId").asText())
        assertEquals("thread-1", clear.required("threadId").asText())
        assertTrue(clear.fields.containsKey("model"))
        assertTrue(clear.fields.containsKey("additionalDirectories"))
        assertTrue(clear.fields.containsKey("mcpServers"))
        assertTrue(clear.fields.containsKey("executionMode"))
    }

    @Test
    fun modesSkillAttachmentsAndCatalogsUseSharedActions() {
        val process = ScriptedProcess()
        val extra = Files.createTempDirectory("codem-extra-dir")
        val file = Files.createTempFile("codem-attach", ".txt")
        Files.writeString(file, "note")
        val diffs = RecordingDiffPresenter()
        val session = session(
            historySource = HistorySource { _, _, cursor ->
                HistoryPage(
                    listOf(HistoryTurn("sub-old", listOf("earlier user"), listOf("earlier assistant"), emptyList())),
                    if (cursor == null) "cursor-2" else null,
                )
            },
            selectionReader = object : SelectionReader {
                override fun current() = SelectionSnapshot("src/Main.kt", 3, 5, "val x = 1", 1, true)
            },
            attachmentStore = object : AttachmentStore {
                override fun validate(path: Path, kind: AttachmentStore.Kind): Path = path
            },
            directoryPicker = DirectoryPicker { extra },
            diffPresenter = diffs,
        ) { startResponder(process, handshakeCapabilities()); process }
        session.connect()
        session.applyViewAction(parseViewAction(JsonValue.obj("type" to JsonValue.Text("resumeThread"), "threadId" to JsonValue.Text("thread-1"))))
        assertEquals(true, session.snapshot().canLoadOlder)
        assertEquals(true, visibleControls(session.snapshot()).older)
        assertEquals("earlier user", session.snapshot().messages.first().text)
        session.applyViewAction(ViewAction.OlderMessages)
        assertEquals(false, session.snapshot().canLoadOlder)

        val modes = session.readModes()
        assertEquals("auto", modes.permissionMode)
        assertEquals("normal", modes.workMode)
        session.applyViewAction(ViewAction.SetWorkMode("plan"))
        assertEquals("plan", session.snapshot().workMode)
        val modeSet = process.writes.map { JsonValue.parse(it).asObject() }
            .first { (it.fields["method"] as? JsonValue.Text)?.value == "thread/mode/set" }
            .required("params").asObject()
        assertEquals("plan", modeSet.required("workMode").asText())
        assertTrue(modeSet.fields.containsKey("expectedRevision"))

        val rows = session.loadCatalog("skills")
        assertEquals("review", rows.first().label)
        session.applyViewAction(ViewAction.SelectSkill("review"))
        session.send("look at this", "req-skill", skillName = "review")
        val skillStart = process.writes.map { JsonValue.parse(it).asObject() }
            .last { (it.fields["method"] as? JsonValue.Text)?.value == "turn/start" }
            .required("params").asObject()
        val skillInput = skillStart.required("input").asObject()
        assertEquals("skill", skillInput.required("type").asText())
        assertEquals("review", skillInput.required("name").asText())
        completeTurn(process, "thread-1", "turn-1")
        awaitSnapshot(session) { it.phase == "ready" }

        session.applyViewAction(ViewAction.SelectSkill(null))
        val selectionId = session.pinSelection()!!
        val attachmentId = session.attach(file, AttachmentStore.Kind.File)
        assertEquals("Main.kt:3-5", session.snapshot().selections.single().label)
        assertEquals(file.fileName.toString(), session.snapshot().attachments.single().label)
        session.send("with context", "req-attach", attachmentIds = listOf(attachmentId), selectionIds = listOf(selectionId))
        val attachStart = process.writes.map { JsonValue.parse(it).asObject() }
            .last { (it.fields["method"] as? JsonValue.Text)?.value == "turn/start" }
            .required("params").asObject()
        val items = attachStart.required("input").asArray().items.map { it.asObject() }
        assertEquals("text", items[0].required("type").asText())
        assertEquals("val x = 1", items[1].required("text").asText())
        val attachments = attachStart.required("extensions").asObject().required("codem").asObject().required("attachments").asArray()
        assertEquals("file", attachments.items.single().asObject().required("kind").asText())
        completeTurn(process, "thread-1", "turn-1")
        awaitSnapshot(session) { it.phase == "ready" }

        session.applyViewAction(ViewAction.AddDirectory)
        assertEquals(extra.fileName.toString(), session.snapshot().sessionTools.directories.single().label)
        val resume = process.writes.map { JsonValue.parse(it).asObject() }
            .last { (it.fields["method"] as? JsonValue.Text)?.value == "thread/resume" }
            .required("params").asObject()
        assertEquals(
            com.codem.intellij.ide.PathGuard.realPathOrNormalized(extra).toString(),
            resume.required("additionalDirectories").asArray().items.single().asText(),
        )

        val env = session.loadCatalog("environment")
        assertTrue(env.none { it.detail.contains("/Users") })
        session.loadCatalog("tools")
        assertEquals("tools", session.snapshot().sessionTools.catalog?.kind)

        val compact = session.compactThread()
        assertEquals("turn-control", compact)
        process.enqueue(
            encodeJson(
                JsonValue.obj(
                    "jsonrpc" to JsonValue.Text("2.0"),
                    "method" to JsonValue.Text("warning"),
                    "params" to JsonValue.obj("message" to JsonValue.Text("compact is incomplete")),
                ),
            ),
        )
        val warned = awaitSnapshot(session) { it.notice != null }
        assertEquals("CodeM reported a warning", warned.notice)
        assertEquals("running", warned.phase)

        process.enqueue(
            encodeJson(
                JsonValue.obj(
                    "jsonrpc" to JsonValue.Text("2.0"),
                    "method" to JsonValue.Text("turn/plan/updated"),
                    "params" to JsonValue.obj(
                        "threadId" to JsonValue.Text("thread-1"),
                        "plan" to JsonValue.ArrayValue(listOf(JsonValue.obj("content" to JsonValue.Text("read file"), "status" to JsonValue.Text("pending")))),
                    ),
                ),
            ),
        )
        process.enqueue(
            encodeJson(
                JsonValue.obj(
                    "jsonrpc" to JsonValue.Text("2.0"),
                    "method" to JsonValue.Text("thread/tokenUsage/updated"),
                    "params" to JsonValue.obj("inputTokens" to JsonValue.NumberValue(3.0, "3"), "outputTokens" to JsonValue.NumberValue(1.0, "1")),
                ),
            ),
        )
        process.enqueue(
            encodeJson(
                JsonValue.obj(
                    "jsonrpc" to JsonValue.Text("2.0"),
                    "method" to JsonValue.Text("turn/diff/updated"),
                    "params" to JsonValue.obj(
                        "diff" to JsonValue.ArrayValue(
                            listOf(JsonValue.obj("path" to JsonValue.Text("src/App.kt"), "linesAdded" to JsonValue.NumberValue(2.0, "2"), "linesRemoved" to JsonValue.NumberValue(1.0, "1"))),
                        ),
                    ),
                ),
            ),
        )
        process.enqueue(
            encodeJson(
                JsonValue.obj(
                    "jsonrpc" to JsonValue.Text("2.0"),
                    "method" to JsonValue.Text("thread/status/changed"),
                    "params" to JsonValue.obj("status" to JsonValue.Text("idle")),
                ),
            ),
        )
        val runtime = awaitSnapshot(session) { it.capabilities.plan.isNotEmpty() && it.diffs.isNotEmpty() }
        assertEquals("read file", runtime.capabilities.plan.single().content)
        assertEquals(3, runtime.capabilities.usage?.input)
        assertEquals("App.kt", runtime.diffs.single().label)
        assertEquals("idle", runtime.capabilities.threadStatus)
        assertEquals("CodeM reported a warning", runtime.notice)
        // 只有行数汇总时不能打开：没有差异内容就不许拿文件名充数。
        assertEquals(false, runtime.diffs.single().available)
        var withoutContent = false
        try {
            session.applyViewAction(ViewAction.OpenDiff("diff-1"))
        } catch (error: CodemError) {
            withoutContent = error.errorClass == CodemError.Class.Validation
        }
        assertTrue(withoutContent)
        assertTrue(diffs.opened.isEmpty())

        enqueueFileDiff(process, "src/App.kt")
        val withContent = awaitSnapshot(session) { it.diffs.single().available }
        assertEquals("complete", withContent.diffs.single().preview)
        session.applyViewAction(ViewAction.OpenDiff("diff-1"))
        val (openedPreview, openedTexts) = diffs.opened.single()
        assertEquals("App.kt", openedPreview.label)
        assertEquals("src/App.kt", openedPreview.path)
        assertEquals("val kept = 1\nval before = 2", openedTexts.before)
        assertEquals("val kept = 1\nval after = 2", openedTexts.after)

        session.applyViewAction(ViewAction.RefreshBackground)
        assertEquals("12", session.snapshot().background.single().id)
        completeTurn(process, "thread-1", "turn-control")
        awaitSnapshot(session) { it.phase == "ready" }
        session.applyViewAction(ViewAction.ManageThread("fork", "thread-1", "", "req-fork"))
        assertTrue(process.writes.any { JsonValue.parse(it).asObject().fields["method"]?.let { method -> (method as? JsonValue.Text)?.value == "thread/fork" } == true })
    }

    @Test
    fun sendProjectsLiveUserAndAssistantMessages() {
        val published = mutableListOf<com.codem.intellij.webview.ChatSnapshot>()
        val process = ScriptedProcess()
        val session = session(onSnapshot = { published += it }) { startResponder(process, handshakeCapabilities()); process }
        session.connect()
        session.send("hello world", "req-live")
        val afterSend = session.snapshot()
        assertEquals("hello world", afterSend.messages.single { it.role == "user" }.text)
        assertTrue(afterSend.phase == "sending" || afterSend.phase == "running")
        process.enqueue(
            encodeJson(
                JsonValue.obj(
                    "jsonrpc" to JsonValue.Text("2.0"),
                    "method" to JsonValue.Text("item/agentMessage/delta"),
                    "params" to JsonValue.obj(
                        "threadId" to JsonValue.Text("thread-1"),
                        "delta" to JsonValue.Text("Hi from locked Core"),
                    ),
                ),
            ),
        )
        awaitSnapshot(session) { it.assistantText.contains("Hi from locked Core") }
        completeTurn(process, "thread-1", "turn-1")
        val done = awaitSnapshot(session) { snap ->
            snap.messages.any { it.role == "assistant" && it.text == "Hi from locked Core" } && snap.assistantText.isEmpty()
        }
        assertEquals("ready", done.phase)
        assertTrue(published.any { it.assistantText.contains("Hi from locked Core") })
        assertTrue(published.any { it.messages.any { message -> message.role == "assistant" } })
    }

    /** 审批入队是界面事实：不推快照，卡片就永远不出现，用户也无从回复。 */
    @Test
    fun approvalRequestIsPublishedAndClearedAfterReply() {
        val published = mutableListOf<com.codem.intellij.webview.ChatSnapshot>()
        val process = ScriptedProcess()
        val session = session(onSnapshot = { published += it }) { startResponder(process, handshakeCapabilities()); process }
        session.connect()
        session.send("edit the file", "req-approval")
        process.enqueue(
            encodeJson(
                JsonValue.obj(
                    "jsonrpc" to JsonValue.Text("2.0"),
                    "id" to JsonValue.NumberValue(7.0, "7"),
                    "method" to JsonValue.Text("item/fileChange/requestApproval"),
                    "params" to JsonValue.obj(
                        "threadId" to JsonValue.Text("thread-1"),
                        "requestId" to JsonValue.Text("approval-1"),
                        "options" to JsonValue.ArrayValue(
                            listOf(
                                JsonValue.obj("optionId" to JsonValue.Text("allow"), "label" to JsonValue.Text("Allow")),
                                JsonValue.obj("optionId" to JsonValue.Text("reject"), "label" to JsonValue.Text("Reject")),
                            ),
                        ),
                    ),
                ),
            ),
        )
        val pending = awaitPublished(published) { it.pendingPanel != null }
        assertEquals("approval-1", pending.pendingInteraction)
        assertEquals("approval", pending.pendingPanel?.kind)
        assertEquals("Allow", pending.pendingPanel?.choices?.first { it.id == "allow" }?.label)

        session.applyViewAction(ViewAction.PanelReply("approval-1", listOf("allow"), "", false))
        assertEquals(null, session.snapshot().pendingPanel)
        assertEquals(null, published.last().pendingPanel)
        val outcome = process.writes.map { JsonValue.parse(it).asObject() }
            .first { it.fields.containsKey("result") && it.fields["result"]?.asObject()?.fields?.containsKey("outcome") == true }
            .required("result").asObject().required("outcome").asObject()
        assertEquals("allow", outcome.required("optionId").asText())
    }

    /** 预检失败不能顺手把用户还在用的连接杀掉。 */
    @Test
    fun failedSpaceSwitchKeepsTheRunningConnection() {
        val processes = mutableListOf<ScriptedProcess>()
        val space = FailingSpace()
        val session = session(spaceOverride = space) { process ->
            processes += process
            startResponder(process, handshakeCapabilities())
            process
        }
        session.connect()
        assertEquals("ready", session.snapshot().phase)
        space.failPrepare = true
        var failed = false
        try {
            session.chooseSpace("other")
        } catch (_: Exception) {
            failed = true
        }
        assertTrue(failed)
        assertEquals(1, processes.size)
        assertTrue(processes[0].isAlive)
        val after = session.snapshot()
        assertEquals("ready", after.phase)
        assertEquals("CodeM space other is not available", after.notice)
        assertEquals("turn-1", session.send("still usable", "req-after-failure"))
    }

    @Test
    fun candidateFailuresKeepOldThreadAndConnectionUsable() {
        for (failure in listOf("initialize", "model/list", "spawn")) {
            val processes = mutableListOf<ScriptedProcess>()
            val session = session { process ->
                processes += process
                if (processes.size == 2 && failure == "spawn") throw CodemError.Process("fixture spawn failed")
                startResponder(process, handshakeCapabilities(), if (processes.size == 2) failure else null)
                process
            }
            try {
                session.connect()
                session.resumeThread("thread-old")
                session.saveDraft("keep this draft")
                val before = session.snapshot()
                org.junit.jupiter.api.Assertions.assertThrows(Exception::class.java) { session.chooseSpace("other") }
                val after = session.snapshot()
                assertEquals("ready", after.phase, failure)
                assertEquals(before.threadId, after.threadId, failure)
                assertEquals(before.space, after.space, failure)
                assertEquals(before.messages, after.messages, failure)
                assertEquals(before.composerCatalog, after.composerCatalog, failure)
                assertEquals("keep this draft", session.currentDraft())
                assertTrue(processes.first().isAlive)
                if (failure != "spawn") assertTrue(!processes.last().isAlive)
                assertEquals("turn-1", session.send("still usable", "after-$failure"))
            } finally { session.close().join() }
        }
    }

    @Test
    fun successfulSpaceSwitchStartsFreshAndRejectsRetiredEvents() {
        val processes = mutableListOf<ScriptedProcess>()
        val session = session { process ->
            processes += process
            startResponder(process, handshakeCapabilities())
            process
        }
        try {
            session.connect()
            session.send("old message", "old-request")
            // Active turns must finish or be stopped explicitly before a connection switch.
            org.junit.jupiter.api.Assertions.assertThrows(CodemError.Conflict::class.java) { session.chooseSpace("other") }
            assertEquals(1, processes.size)
            completeTurn(processes.first(), "thread-1", "turn-1")
            awaitSnapshot(session) { it.phase == "ready" }
            session.showHistory()
            session.loadCatalog("skills")
            session.saveDraft("unsent")
            session.chooseSpace("other")
            val after = session.snapshot()
            assertEquals("ready", after.phase)
            assertEquals("other", after.space)
            assertEquals(null, after.threadId)
            assertEquals(null, after.resumeThreadId)
            assertTrue(after.messages.isEmpty())
            assertTrue(after.turnTimings.isEmpty())
            assertTrue(after.sessionTools.skills.isEmpty())
            assertTrue(after.history.entries.isEmpty())
            assertEquals(false, after.hasOlderMessages)
            assertEquals("unsent", session.currentDraft())
            assertTrue(!processes.first().isAlive)
            session.send("new space", "new-request")
            val methods = processes.last().writes.map { JsonValue.parse(it).asObject().fields["method"] }
            assertEquals(1, methods.count { it == JsonValue.Text("thread/start") })
            assertEquals(1, methods.count { it == JsonValue.Text("model/list") })
        } finally { session.close().join() }
    }

    @Test
    fun closingDuringCandidateHandshakeWaitsForCleanupAndNeverCommits() {
        val entered = java.util.concurrent.CountDownLatch(1)
        val release = java.util.concurrent.CountDownLatch(1)
        val processes = java.util.concurrent.CopyOnWriteArrayList<ScriptedProcess>()
        val session = session { process ->
            processes += process
            val candidate = processes.size == 2
            startResponder(process, handshakeCapabilities(), beforeReply = { method ->
                if (candidate && method == "initialize") {
                    entered.countDown()
                    check(release.await(2, java.util.concurrent.TimeUnit.SECONDS))
                }
            })
            process
        }
        session.connect()
        val switching = java.util.concurrent.CompletableFuture.runAsync { session.chooseSpace("other") }
        try {
            assertTrue(entered.await(2, java.util.concurrent.TimeUnit.SECONDS))
            org.junit.jupiter.api.Assertions.assertThrows(CodemError.Conflict::class.java) { session.chooseSpace("third") }
            val closing = session.close()
            assertTrue(!closing.isDone)
            release.countDown()
            org.junit.jupiter.api.Assertions.assertThrows(Exception::class.java) { switching.get(3, java.util.concurrent.TimeUnit.SECONDS) }
            closing.get(3, java.util.concurrent.TimeUnit.SECONDS)
            assertTrue(processes.none { it.isAlive })
            assertEquals("disconnected", session.snapshot().phase)
        } finally {
            release.countDown()
            session.close().join()
        }
    }

    @Test
    fun sendReceiptRejectsThreadAndTurnFailuresAndRemovesOptimisticRows() {
        for (failure in listOf("thread/start", "turn/start")) {
            val published = java.util.concurrent.CopyOnWriteArrayList<com.codem.intellij.webview.ChatSnapshot>()
            val session = session(onSnapshot = { published += it }) { process ->
                startResponder(process, handshakeCapabilities(), failMethod = failure)
                process
            }
            try {
                session.connect()
                org.junit.jupiter.api.Assertions.assertThrows(Exception::class.java) { session.send("keep me", "rejected") }
                val optimistic = published.first { it.messages.any { message -> message.id == "rejected" } }
                assertEquals(null, optimistic.submission)
                val rejected = published.last()
                assertEquals("rejected", rejected.submission?.requestId)
                assertEquals(false, rejected.submission?.accepted)
                assertTrue(rejected.messages.none { it.id == "rejected" })
                assertEquals("ready", rejected.phase)
                val wire = com.codem.intellij.webview.encodeChatSnapshot(rejected).required("submission").asObject()
                assertEquals(JsonValue.Bool(false), wire.required("accepted"))
            } finally { session.close().join() }
        }
    }

    @Test
    fun noAcceptedReceiptBeforeCoreReplyAndValidationAlsoRejects() {
        val entered = java.util.concurrent.CountDownLatch(1)
        val release = java.util.concurrent.CountDownLatch(1)
        val published = java.util.concurrent.CopyOnWriteArrayList<com.codem.intellij.webview.ChatSnapshot>()
        val session = session(onSnapshot = { published += it }) { process ->
            startResponder(process, handshakeCapabilities(), beforeReply = { method ->
                if (method == "turn/start") {
                    entered.countDown()
                    check(release.await(2, java.util.concurrent.TimeUnit.SECONDS))
                }
            })
            process
        }
        try {
            org.junit.jupiter.api.Assertions.assertThrows(CodemError.Conflict::class.java) { session.send("disconnected", "early") }
            assertEquals(false, published.last().submission?.accepted)
            session.connect()
            val sending = java.util.concurrent.CompletableFuture.supplyAsync { session.send("keep draft until accepted", "accepted") }
            assertTrue(entered.await(2, java.util.concurrent.TimeUnit.SECONDS))
            assertTrue(published.none { it.submission?.requestId == "accepted" })
            assertTrue(session.snapshot().messages.any { it.id == "accepted" })
            release.countDown()
            assertEquals("turn-1", sending.get(3, java.util.concurrent.TimeUnit.SECONDS))
            assertEquals(true, published.last().submission?.accepted)
            assertEquals("accepted", published.last().submission?.requestId)
            org.junit.jupiter.api.Assertions.assertThrows(CodemError.Conflict::class.java) { session.send("duplicate", "duplicate") }
            assertEquals(false, published.last().submission?.accepted)
            assertTrue(session.snapshot().messages.any { it.id == "accepted" })
        } finally {
            release.countDown()
            session.close().join()
        }
    }

    @Test
    fun supplementaryActionsPublishExplicitRejection() {
        val session = session { process -> startResponder(process, handshakeCapabilities()); process }
        for (action in listOf(
            ViewAction.Steer("thread-1", "steer", "steer-rejected"),
            ViewAction.AskSideQuestion("thread-1", "question", "side-rejected"),
            ViewAction.ShellCommand("thread-1", "pwd", "shell-rejected"),
        )) {
            org.junit.jupiter.api.Assertions.assertThrows(CodemError.Conflict::class.java) { session.applyViewAction(action) }
            assertEquals(false, session.snapshot().submission?.accepted)
        }
    }

    @Test
    fun historyListAndModelCatalogUseCoreResults() {
        val process = ScriptedProcess()
        val session = session { startResponder(process, handshakeCapabilities()); process }
        session.connect()
        assertEquals(listOf("Auto", "other-model"), session.snapshot().composerCatalog.models.map { it.label })
        assertEquals(true, session.snapshot().composerCatalog.models.first().selected)
        session.applyViewAction(ViewAction.ChooseModel("model-2"))
        assertEquals("other-model", session.snapshot().model)
        session.showHistory()
        val history = session.snapshot().history
        assertEquals(true, history.open)
        assertEquals("昨天的问题", history.entries.single().title)
        assertEquals(false, history.entries.single().archived)
        session.closeHistory()
        assertEquals(false, session.snapshot().history.open)
    }

    @Test
    fun skillWithAttachmentsIsRejected() {
        val process = ScriptedProcess()
        val session = session { startResponder(process, handshakeCapabilities()); process }
        session.connect()
        session.resumeThread("thread-1")
        var failed = false
        try {
            session.send("nope", "req-bad", skillName = "review", attachmentIds = listOf("att-1"))
        } catch (error: CodemError) {
            failed = error.errorClass == CodemError.Class.Validation
        }
        assertTrue(failed)
    }

    /** 一条完整的 item/fileChange/delta：分两片送达，complete 后才产出内容。 */
    private fun enqueueFileDiff(process: ScriptedProcess, path: String) {
        val payload = encodeJson(
            JsonValue.obj(
                "tool_call_id" to JsonValue.Text("call-diff"),
                "path" to JsonValue.Text(path),
                "change_type" to JsonValue.Text("modified"),
                "is_binary" to JsonValue.Bool(false),
                "truncated" to JsonValue.Bool(false),
                "stats" to JsonValue.obj(
                    "lines_added" to JsonValue.NumberValue(1.0, "1"),
                    "lines_removed" to JsonValue.NumberValue(1.0, "1"),
                ),
                "hunks" to JsonValue.ArrayValue(
                    listOf(
                        JsonValue.obj(
                            "old_start" to JsonValue.NumberValue(1.0, "1"),
                            "old_count" to JsonValue.NumberValue(2.0, "2"),
                            "new_start" to JsonValue.NumberValue(1.0, "1"),
                            "new_count" to JsonValue.NumberValue(2.0, "2"),
                            "lines" to JsonValue.ArrayValue(
                                listOf(
                                    JsonValue.obj("kind" to JsonValue.Text("context"), "text" to JsonValue.Text("val kept = 1")),
                                    JsonValue.obj("kind" to JsonValue.Text("delete"), "text" to JsonValue.Text("val before = 2")),
                                    JsonValue.obj("kind" to JsonValue.Text("insert"), "text" to JsonValue.Text("val after = 2")),
                                ),
                            ),
                        ),
                    ),
                ),
            ),
        )
        val half = payload.length / 2
        listOf(payload.substring(0, half) to false, payload.substring(half) to true)
            .forEachIndexed { index, (chunk, complete) ->
                process.enqueue(
                    encodeJson(
                        JsonValue.obj(
                            "jsonrpc" to JsonValue.Text("2.0"),
                            "method" to JsonValue.Text("item/fileChange/delta"),
                            "params" to JsonValue.obj(
                                "threadId" to JsonValue.Text("thread-1"),
                                "itemId" to JsonValue.Text("item-diff"),
                                "callId" to JsonValue.Text("call-diff"),
                                "sequence" to JsonValue.NumberValue(index.toDouble(), index.toString()),
                                "encoding" to JsonValue.Text("json"),
                                "complete" to JsonValue.Bool(complete),
                                "delta" to JsonValue.Text(chunk),
                            ),
                        ),
                    ),
                )
            }
    }

    /** 只认推送给界面的快照，不看域内部状态，才能证明界面确实被通知到。 */
    private fun awaitPublished(
        published: List<com.codem.intellij.webview.ChatSnapshot>,
        predicate: (com.codem.intellij.webview.ChatSnapshot) -> Boolean,
    ): com.codem.intellij.webview.ChatSnapshot {
        repeat(80) {
            published.toList().lastOrNull(predicate)?.let { return it }
            Thread.sleep(15)
        }
        throw AssertionError("host never published a snapshot matching the predicate")
    }

    private fun awaitSnapshot(session: ProjectSession, predicate: (com.codem.intellij.webview.ChatSnapshot) -> Boolean): com.codem.intellij.webview.ChatSnapshot {
        repeat(80) {
            val snapshot = session.snapshot()
            if (predicate(snapshot)) return snapshot
            Thread.sleep(15)
        }
        throw AssertionError("notification did not reach the snapshot: ${session.snapshot()}")
    }

    private fun completeTurn(process: ScriptedProcess, threadId: String, turnId: String) {
        process.enqueue(
            encodeJson(
                JsonValue.obj(
                    "jsonrpc" to JsonValue.Text("2.0"),
                    "method" to JsonValue.Text("turn/completed"),
                    "params" to JsonValue.obj(
                        "threadId" to JsonValue.Text(threadId),
                        "turn" to JsonValue.obj("id" to JsonValue.Text(turnId), "status" to JsonValue.Text("completed")),
                    ),
                ),
            ),
        )
    }

    private fun session(
        trusted: Boolean = true,
        spaceOverride: SpaceGateway = StubSpace(),
        historySource: HistorySource? = null,
        selectionReader: SelectionReader? = null,
        attachmentStore: AttachmentStore? = null,
        directoryPicker: DirectoryPicker? = null,
        diffPresenter: com.codem.intellij.ide.DiffPresenter = com.codem.intellij.ide.NoopDiffPresenter,
        onSnapshot: ((com.codem.intellij.webview.ChatSnapshot) -> Unit)? = null,
        factory: (ScriptedProcess) -> ScriptedProcess,
    ): ProjectSession {
        val cwd = Files.createTempDirectory("codem-session-cwd")
        val file = Files.createTempFile("codem-core", "")
        Files.writeString(file, "x")
        val target = RuntimeLocator.targets.values.first()
        val runtime = ResolvedRuntime(target, RuntimeLocator.CORE_VERSION, RuntimeLocator.CLI_VERSION, file, file, file, file, "00")
        return ProjectSession(
            runtime = runtime,
            workingDirectory = cwd,
            trusted = trusted,
            timeouts = Timeouts(initializeMs = 2_000, rpcMs = 2_000, closeStageMs = 200),
            processFactory = { _, _, _ -> factory(ScriptedProcess()) },
            authOverride = StubAuth(),
            spaceOverride = spaceOverride,
            selectionReader = selectionReader,
            attachmentStore = attachmentStore,
            diffPresenter = diffPresenter,
            historySource = historySource,
            directoryPicker = directoryPicker,
            onSnapshot = onSnapshot,
        )
    }

    private fun startResponder(
        process: ScriptedProcess,
        capabilities: JsonValue.ObjectValue,
        failMethod: String? = null,
        emptyUnsubscribe: Boolean = false,
        beforeReply: (String) -> Unit = {},
    ) {
        Thread {
            val seen = AtomicInteger(0)
            while (process.isAlive) {
                val all = process.writes.toList()
                if (all.size <= seen.get()) {
                    Thread.sleep(5)
                    continue
                }
                val line = all[seen.getAndIncrement()]
                val obj = try {
                    JsonValue.parse(line).asObject()
                } catch (_: Exception) {
                    continue
                }
                val id = obj.fields["id"] ?: continue
                val method = (obj.fields["method"] as? JsonValue.Text)?.value ?: continue
                val params = obj.fields["params"] as? JsonValue.ObjectValue ?: JsonValue.ObjectValue(emptyMap())
                beforeReply(method)
                if (method == failMethod) {
                    process.enqueue(encodeJson(JsonValue.obj(
                        "jsonrpc" to JsonValue.Text("2.0"), "id" to id,
                        "error" to JsonValue.obj("code" to JsonValue.NumberValue(-32000.0, "-32000"), "message" to JsonValue.Text("fixture rejected $method")),
                    )))
                    continue
                }
                val result = when (method) {
                    "initialize" -> capabilities
                    "thread/start" -> JsonValue.obj("thread" to JsonValue.obj("id" to JsonValue.Text("thread-1")))
                    "thread/unsubscribe" -> if (emptyUnsubscribe) JsonValue.ObjectValue(emptyMap()) else JsonValue.obj("status" to JsonValue.Text("unsubscribed"))
                    "thread/resume" -> JsonValue.obj("thread" to JsonValue.obj("id" to params.required("threadId")))
                    "turn/start" -> JsonValue.obj("turn" to JsonValue.obj("id" to JsonValue.Text("turn-1")))
                    "turn/interrupt" -> JsonValue.ObjectValue(emptyMap())
                    "thread/list" -> JsonValue.obj(
                        "threads" to JsonValue.ArrayValue(
                            listOf(
                                JsonValue.obj(
                                    "id" to JsonValue.Text("thread-1"),
                                    "archived" to JsonValue.Bool(false),
                                    "preview" to JsonValue.Text("昨天的问题"),
                                    "model" to JsonValue.Text("codem-router/auto"),
                                    "profile" to JsonValue.Text("default"),
                                    "startedAt" to JsonValue.Text("2026-09-16T00:00:00Z"),
                                    "turnCount" to JsonValue.NumberValue(1.0, "1"),
                                ),
                            ),
                        ),
                        "nextCursor" to JsonValue.Null,
                        "total" to JsonValue.NumberValue(1.0, "1"),
                    )
                    "model/list" -> JsonValue.obj(
                        "activeModel" to JsonValue.Text("codem-router/auto"),
                        "models" to JsonValue.ArrayValue(
                            listOf(
                                JsonValue.obj("id" to JsonValue.Text("codem-router/auto"), "source" to JsonValue.Text("router"), "supportsVision" to JsonValue.Bool(true), "contextWindowTokens" to JsonValue.NumberValue(1.0, "1")),
                                JsonValue.obj("id" to JsonValue.Text("other-model"), "source" to JsonValue.Text("router"), "supportsVision" to JsonValue.Bool(false), "contextWindowTokens" to JsonValue.NumberValue(1.0, "1")),
                            ),
                        ),
                    )
                    "thread/clear" -> JsonValue.obj(
                        "operationId" to params.required("operationId"),
                        "previousThreadId" to params.required("threadId"),
                        "thread" to JsonValue.obj(
                            "id" to JsonValue.Text("thread-new"),
                            "cwd" to params.required("cwd"),
                            "status" to JsonValue.Text("loaded"),
                        ),
                    )
                    "thread/compact/start", "thread/rewind/start" ->
                        JsonValue.obj("turn" to JsonValue.obj("id" to JsonValue.Text("turn-control")))
                    "turn/steer" -> JsonValue.obj(
                        "turnId" to params.required("expectedTurnId"),
                        "submissionId" to params.required("submissionId"),
                    )
                    "thread/mode/read" -> modeResult(params, 0, "auto", "normal")
                    "thread/mode/set" -> modeResult(
                        params,
                        ((params.fields["expectedRevision"] as? JsonValue.NumberValue)?.value?.toInt() ?: 0) + 1,
                        (params.fields["permissionMode"] as? JsonValue.Text)?.value ?: "auto",
                        (params.fields["workMode"] as? JsonValue.Text)?.value ?: "normal",
                    )
                    "skills/list" -> JsonValue.obj(
                        "skills" to JsonValue.ArrayValue(
                            listOf(JsonValue.obj("name" to JsonValue.Text("review"), "description" to JsonValue.Text("structured skill"))),
                        ),
                    )
                    "environment/info" -> JsonValue.obj("cwd" to JsonValue.Text("/Users/secret/project"), "os" to JsonValue.Text("darwin"))
                    "config/read" -> JsonValue.obj("config" to JsonValue.obj("name" to JsonValue.Text("local")))
                    "hooks/list" -> JsonValue.obj("hooks" to JsonValue.ArrayValue(listOf(JsonValue.obj("name" to JsonValue.Text("pre")))))
                    "plugin/list" -> JsonValue.obj("plugins" to JsonValue.ArrayValue(emptyList()))
                    "permissionProfile/list" -> JsonValue.obj("profiles" to JsonValue.ArrayValue(emptyList()))
                    "space/list" -> JsonValue.obj("spaces" to JsonValue.ArrayValue(listOf(JsonValue.obj("id" to JsonValue.Text("proj"), "name" to JsonValue.Text("Proj")))))
                    "modelProvider/capabilities/read" -> JsonValue.obj("name" to JsonValue.Text("router"))
                    "tools/list" -> JsonValue.obj("tools" to JsonValue.ArrayValue(listOf(JsonValue.obj("name" to JsonValue.Text("bash"), "description" to JsonValue.Text("shell")))))
                    "thread/turns/list" -> JsonValue.obj("turns" to JsonValue.ArrayValue(emptyList()), "nextCursor" to JsonValue.Null)
                    "thread/backgroundTerminals/list" -> JsonValue.obj(
                        "terminals" to JsonValue.ArrayValue(
                            listOf(JsonValue.obj("processId" to JsonValue.NumberValue(12.0, "12"), "inProgress" to JsonValue.Bool(true))),
                        ),
                    )
                    "thread/backgroundTerminals/terminate", "thread/backgroundTerminals/clean" -> JsonValue.ObjectValue(emptyMap())
                    "thread/fork" -> JsonValue.obj("thread" to JsonValue.obj("id" to JsonValue.Text("thread-fork")))
                    "thread/name/set", "thread/archive", "thread/unarchive", "thread/delete" -> JsonValue.ObjectValue(emptyMap())
                    else -> JsonValue.ObjectValue(emptyMap())
                }
                process.enqueue(
                    encodeJson(
                        JsonValue.obj(
                            "jsonrpc" to JsonValue.Text("2.0"),
                            "id" to id,
                            "result" to result,
                        ),
                    ),
                )
            }
        }.apply { isDaemon = true; name = "codem-test-responder"; start() }
    }

    private fun handshakeCapabilities(): JsonValue.ObjectValue {
        val handshake = java.nio.file.Path.of("packages/contracts/core/initializeHandshake.json")
            .let { if (Files.isRegularFile(it)) it else java.nio.file.Path.of("../../packages/contracts/core/initializeHandshake.json") }
        val sample = JsonValue.parse(Files.readString(handshake)).asObject()
        val events = sample.required("events") as JsonValue.ArrayValue
        val frame = events.items.first().asObject().required("frame").asObject()
        return frame.required("result").asObject()
    }

    private fun modeResult(params: JsonValue.ObjectValue, revision: Int, permission: String, work: String): JsonValue.ObjectValue =
        JsonValue.obj(
            "threadId" to params.required("threadId"),
            "state" to JsonValue.obj(
                "revision" to JsonValue.NumberValue(revision.toDouble(), revision.toString()),
                "permissionEpoch" to JsonValue.NumberValue(0.0, "0"),
                "permissionMode" to JsonValue.Text(permission),
                "workMode" to JsonValue.Text(work),
            ),
        )

    private class StubAuth : AuthGateway {
        override fun status() = AuthStatus(true, "cli", true, null, null, "u1", "User")
        override fun assertAuthenticated(status: AuthStatus) = Unit
    }

    private class StubSpace : SpaceGateway {
        override fun prepareInitial(requestedKey: String?) = SpacePreparation.Prepared(
            SpaceList("proj", listOf(Space("proj", "Proj"))),
            PreparedSpace("proj", "Proj", null),
        )
        override fun prepare(projectKey: String) = PreparedSpace(projectKey, projectKey, null)
        override fun launchArguments(space: PreparedSpace): Pair<List<String>, Map<String, String>> =
            emptyList<String>() to emptyMap()
    }

    private class FailingSpace : SpaceGateway {
        var failPrepare = false
        override fun prepareInitial(requestedKey: String?) = SpacePreparation.Prepared(
            SpaceList("proj", listOf(Space("proj", "Proj"))),
            PreparedSpace("proj", "Proj", null),
        )

        override fun prepare(projectKey: String): PreparedSpace {
            if (failPrepare) throw CodemError.Validation("CodeM space $projectKey is not available")
            return PreparedSpace(projectKey, projectKey, null)
        }

        override fun launchArguments(space: PreparedSpace): Pair<List<String>, Map<String, String>> =
            emptyList<String>() to emptyMap()
    }
}
