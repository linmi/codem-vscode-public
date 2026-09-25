package com.codem.intellij.session

import com.codem.intellij.account.AuthGateway
import com.codem.intellij.account.AuthStatus
import com.codem.intellij.account.PreparedSpace
import com.codem.intellij.account.Space
import com.codem.intellij.account.SpaceGateway
import com.codem.intellij.account.SpaceList
import com.codem.intellij.account.SpacePreparation
import com.codem.intellij.contracts.ContractFixtures
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
import com.codem.intellij.webview.encodeChatSnapshot
import com.codem.intellij.webview.initialSnapshot
import com.codem.intellij.webview.parseViewAction
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
        assertEquals(false, after.canLoadOlder)
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

    /** 协议错误必须推送 failed；失败原因不被后续操作覆盖；重试起新 Core 而不是退回死连接。 */
    @Test
    fun protocolErrorPublishesFailureAndRetryStartsAFreshCore() {
        val published = java.util.concurrent.CopyOnWriteArrayList<com.codem.intellij.webview.ChatSnapshot>()
        val processes = java.util.concurrent.CopyOnWriteArrayList<ScriptedProcess>()
        val session = session(onSnapshot = { published += it }) { process ->
            processes += process
            startResponder(process, handshakeCapabilities())
            process
        }
        try {
            session.connect()
            session.resumeThread("thread-1")
            processes.single().enqueue("{not json")
            val failed = awaitPublished(published) { it.phase == "failed" }
            assertEquals("CodeM connection failed", failed.notice)
            assertEquals(true, failed.canRetry)
            assertEquals(null, failed.threadId)
            assertEquals("thread-1", failed.resumeThreadId)
            assertEquals(false, failed.canResume)
            awaitCondition { !processes.single().isAlive }
            org.junit.jupiter.api.Assertions.assertThrows(CodemError.Conflict::class.java) { session.send("too early", "req-dead") }
            assertEquals("CodeM connection failed", session.snapshot().notice)

            session.connect()
            assertEquals(2, processes.size)
            val retried = session.snapshot()
            assertEquals("ready", retried.phase)
            assertEquals(null, retried.notice)
            assertEquals("turn-1", session.send("after retry", "req-retry"))
        } finally { session.close().join() }
    }

    /** 轮次中退出：不再显示运行中，审批撤销，未完成工具留作 incomplete，重试不被“活动轮次”挡住。 */
    @Test
    fun coreExitDuringTurnEndsTheTurnAndAllowsRetry() {
        val published = java.util.concurrent.CopyOnWriteArrayList<com.codem.intellij.webview.ChatSnapshot>()
        val processes = java.util.concurrent.CopyOnWriteArrayList<ScriptedProcess>()
        val session = session(onSnapshot = { published += it }) { process ->
            processes += process
            startResponder(process, handshakeCapabilities())
            process
        }
        try {
            session.connect()
            session.send("hello", "req-crash")
            val process = processes.single()
            enqueueNotification(process, "item/started", JsonValue.obj(
                "threadId" to JsonValue.Text("thread-1"),
                "turnId" to JsonValue.Text("turn-1"),
                "item" to JsonValue.obj(
                    "id" to JsonValue.Text("tool-1"),
                    "type" to JsonValue.Text("commandExecution"),
                    "status" to JsonValue.Text("inProgress"),
                    "tool" to JsonValue.Text("run_bash"),
                ),
            ))
            enqueueNotification(process, "item/agentMessage/delta", JsonValue.obj(
                "threadId" to JsonValue.Text("thread-1"),
                "delta" to JsonValue.Text("partial answer"),
            ))
            process.enqueue(encodeJson(JsonValue.obj(
                "jsonrpc" to JsonValue.Text("2.0"), "id" to JsonValue.Text("approval-rpc"),
                "method" to JsonValue.Text("item/tool/requestApproval"),
                "params" to JsonValue.obj("threadId" to JsonValue.Text("thread-1"),
                    "options" to JsonValue.ArrayValue(listOf(JsonValue.obj("id" to JsonValue.Text("allow_once"))))),
            )))
            awaitSnapshot(session) { it.pendingPanel != null && it.assistantText == "partial answer" }

            process.destroy(true)
            val failed = awaitPublished(published) { it.phase == "failed" }
            assertEquals("CodeM Core exited unexpectedly (exit code 137, signal SIGKILL)", failed.notice)
            assertEquals(true, failed.canRetry)
            assertEquals(null, failed.pendingPanel)
            assertEquals("", failed.assistantText)
            assertEquals("hello", failed.messages.single { it.role == "user" }.text)
            assertEquals("incomplete", failed.messages.single { it.role == "tool" }.status)
            assertTrue(failed.messages.none { it.role == "assistant" })
            assertTrue(failed.turnTimings.single().finishedAt != null)
            assertEquals(null, failed.threadId)
            assertEquals("thread-1", failed.resumeThreadId)
            org.junit.jupiter.api.Assertions.assertThrows(CodemError.Conflict::class.java) { session.stop() }

            session.connect()
            assertEquals(2, processes.size)
            assertEquals("ready", session.snapshot().phase)
            assertEquals("turn-1", session.send("after retry", "req-retry"))
        } finally { session.close().join() }
    }

    /** turn/start 未确认就退出：撤回乐观行、回执为拒绝，失败原因不被随后的发送失败覆盖。 */
    @Test
    fun coreExitBeforeTurnStartIsAcknowledgedWithdrawsTheOptimisticRow() {
        val session = session { process ->
            startResponder(process, handshakeCapabilities(), beforeReply = { if (it == "turn/start") process.destroy(true) })
            process
        }
        try {
            session.connect()
            org.junit.jupiter.api.Assertions.assertThrows(Exception::class.java) { session.send("lost", "req-lost") }
            val failed = awaitSnapshot(session) { it.phase == "failed" }
            assertEquals("CodeM Core exited unexpectedly (exit code 137, signal SIGKILL)", failed.notice)
            assertEquals(true, failed.canRetry)
            assertTrue(failed.messages.none { it.id == "req-lost" })
            assertEquals("req-lost", failed.submission?.requestId)
            assertEquals(false, failed.submission?.accepted)
        } finally { session.close().join() }
    }

    /** 失败连接上的重试再失败时停在 failed，不能因为死 Core 仍挂着而退回 ready。 */
    @Test
    fun failedRetryAfterCoreExitStaysFailed() {
        val processes = java.util.concurrent.CopyOnWriteArrayList<ScriptedProcess>()
        val space = FailingSpace()
        val session = session(spaceOverride = space) { process ->
            processes += process
            startResponder(process, handshakeCapabilities())
            process
        }
        try {
            session.connect()
            processes.single().destroy(true)
            awaitSnapshot(session) { it.phase == "failed" }
            space.failPrepare = true
            org.junit.jupiter.api.Assertions.assertThrows(CodemError.Validation::class.java) { session.chooseSpace("other") }
            val after = session.snapshot()
            assertEquals("failed", after.phase)
            assertEquals("CodeM space other is not available", after.notice)
            assertEquals(true, after.canRetry)
            assertEquals(1, processes.size)
        } finally { session.close().join() }
    }

    /**
     * 认证失效按断线处理：推送 failed 并可重试，轮次与审批结束，Core 被关闭，草稿保留。
     * 登录仍无效时 connect/chooseSpace 重试都停在 failed，不因旧 Core 挂着退回 ready；重新登录后重试才起新 Core。
     */
    @Test
    fun authInvalidationDetachesTheCoreSoAFailedRetryStaysFailed() {
        val published = java.util.concurrent.CopyOnWriteArrayList<com.codem.intellij.webview.ChatSnapshot>()
        val processes = java.util.concurrent.CopyOnWriteArrayList<ScriptedProcess>()
        val auth = StubAuth()
        val session = session(auth = auth, onSnapshot = { published += it }) { process ->
            processes += process
            startResponder(process, handshakeCapabilities())
            process
        }
        try {
            session.connect()
            session.saveDraft("keep me")
            session.send("hello", "req-auth")
            val process = processes.single()
            enqueueNotification(process, "item/started", JsonValue.obj(
                "threadId" to JsonValue.Text("thread-1"),
                "turnId" to JsonValue.Text("turn-1"),
                "item" to JsonValue.obj(
                    "id" to JsonValue.Text("tool-1"),
                    "type" to JsonValue.Text("commandExecution"),
                    "status" to JsonValue.Text("inProgress"),
                    "tool" to JsonValue.Text("run_bash"),
                ),
            ))
            process.enqueue(encodeJson(JsonValue.obj(
                "jsonrpc" to JsonValue.Text("2.0"), "id" to JsonValue.Text("approval-rpc"),
                "method" to JsonValue.Text("item/tool/requestApproval"),
                "params" to JsonValue.obj("threadId" to JsonValue.Text("thread-1"),
                    "options" to JsonValue.ArrayValue(listOf(JsonValue.obj("id" to JsonValue.Text("allow_once"))))),
            )))
            awaitSnapshot(session) { it.pendingPanel != null }

            enqueueNotification(process, "auth/invalidated", JsonValue.ObjectValue(emptyMap()))
            val failed = awaitPublished(published) { it.phase == "failed" }
            assertEquals("CodeM authentication is no longer valid", failed.notice)
            assertEquals(true, failed.canRetry)
            assertEquals(null, failed.pendingPanel)
            assertEquals("incomplete", failed.messages.single { it.role == "tool" }.status)
            assertEquals(null, failed.threadId)
            assertEquals("thread-1", failed.resumeThreadId)
            assertEquals(false, failed.canResume)
            awaitCondition { !process.isAlive }
            assertEquals("keep me", session.currentDraft())
            org.junit.jupiter.api.Assertions.assertThrows(CodemError.Conflict::class.java) { session.send("too early", "req-dead") }
            assertEquals("CodeM authentication is no longer valid", session.snapshot().notice)

            auth.loggedIn = false
            org.junit.jupiter.api.Assertions.assertThrows(CodemError.Authentication::class.java) { session.connect() }
            val retryFailed = session.snapshot()
            assertEquals("failed", retryFailed.phase)
            assertEquals("CodeM login is required before starting App Server threads", retryFailed.notice)
            assertEquals(true, retryFailed.canRetry)
            org.junit.jupiter.api.Assertions.assertThrows(CodemError.Authentication::class.java) { session.chooseSpace("proj") }
            assertEquals("failed", session.snapshot().phase)
            assertEquals(1, processes.size)

            auth.loggedIn = true
            session.connect()
            assertEquals(2, processes.size)
            val retried = session.snapshot()
            assertEquals("ready", retried.phase)
            assertEquals(null, retried.notice)
            assertEquals("turn-1", session.send("after login", "req-relogin"))
        } finally { session.close().join() }
    }

    /** 读线程回调（如 JCEF 推送）抛出非 CodeM 异常时，连接明确失败，而不是 stdout 读线程静默死亡。 */
    @Test
    fun snapshotSubscriberFailureFailsTheConnectionInsteadOfSilencingTheReader() {
        val processes = java.util.concurrent.CopyOnWriteArrayList<ScriptedProcess>()
        val session = session(onSnapshot = { snapshot ->
            if (snapshot.assistantText.contains("explode")) throw IllegalStateException("fixture snapshot push failed")
        }) { process ->
            processes += process
            startResponder(process, handshakeCapabilities())
            process
        }
        try {
            session.connect()
            session.send("hello", "req-push")
            enqueueNotification(processes.single(), "item/agentMessage/delta", JsonValue.obj(
                "threadId" to JsonValue.Text("thread-1"),
                "delta" to JsonValue.Text("explode"),
            ))
            val failed = awaitSnapshot(session) { it.phase == "failed" }
            assertEquals("CodeM connection failed", failed.notice)
            assertEquals(true, failed.canRetry)
            awaitCondition { !processes.single().isAlive }
            session.connect()
            assertEquals("ready", session.snapshot().phase)
        } finally { session.close().join() }
    }

    /** 句柄按单调序号分配：删除后再添加不复用旧 id，删除一个不会连带删掉另一个。 */
    @Test
    fun directoryAndSelectionHandlesStayUniqueAfterRemoval() {
        val folders = (1..3).map { Files.createTempDirectory("codem-extra-$it") }
        var selection = SelectionSnapshot("src/A.kt", 1, 1, "same text", 1, true)
        val session = session(selectionReader = object : SelectionReader {
            override fun current() = selection
        }) { ScriptedProcess() }

        session.addDirectory(folders[0])
        session.addDirectory(folders[1])
        session.removeDirectory(session.snapshot().sessionTools.directories.first().id)
        session.addDirectory(folders[2])
        val directories = session.snapshot().sessionTools.directories
        assertEquals(2, directories.map { it.id }.toSet().size)
        session.removeDirectory(directories.first().id)
        assertEquals(listOf(folders[2].fileName.toString()), session.snapshot().sessionTools.directories.map { it.label })

        val first = session.pinSelection()!!
        selection = SelectionSnapshot("src/B.kt", 1, 1, "same text", 1, true)
        val second = session.pinSelection()!!
        assertEquals(second, session.pinSelection())
        session.removeSelection(first)
        selection = SelectionSnapshot("src/C.kt", 1, 1, "other text", 1, true)
        val third = session.pinSelection()!!
        assertEquals(2, setOf(second, third).size)
        session.removeSelection(second)
        assertEquals(listOf("C.kt:1-1"), session.snapshot().selections.map { it.label })
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
            resume.required("additionalDirectories").asArray().items.first().asText(),
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
        val runtime = awaitSnapshot(session) { it.capabilities.plan.isNotEmpty() && it.diffs.isNotEmpty() && it.capabilities.threadStatus != null }
        assertEquals("read file", runtime.capabilities.plan.single().content)
        assertEquals(3, runtime.capabilities.usage?.input)
        assertEquals("App.kt", runtime.diffs.single().label)
        assertEquals("idle", runtime.capabilities.threadStatus)
        assertEquals("CodeM reported a warning", runtime.notice)
        // 只有行数汇总时不能打开：没有差异内容就不许拿文件名充数。
        assertEquals(false, runtime.diffs.single().available)
        var withoutContent = false
        try {
            session.applyViewAction(ViewAction.OpenDiff(session.snapshot().diffs.single().id))
        } catch (error: CodemError) {
            withoutContent = error.errorClass == CodemError.Class.Validation
        }
        assertTrue(withoutContent)
        assertTrue(diffs.opened.isEmpty())

        enqueueFileDiff(process, "src/App.kt")
        val withContent = awaitSnapshot(session) { it.diffs.single().available }
        assertEquals("complete", withContent.diffs.single().preview)
        session.applyViewAction(ViewAction.OpenDiff(session.snapshot().diffs.single().id))
        val (openedPreview, openedTexts) = diffs.opened.single()
        assertEquals("App.kt", openedPreview.label)
        assertEquals("src/App.kt", openedPreview.path)
        assertEquals("val kept = 1\nval before = 2", openedTexts.before)
        assertEquals("val kept = 1\nval after = 2", openedTexts.after)

        session.applyViewAction(ViewAction.RefreshBackground)
        assertEquals("4242", session.snapshot().background.single().id)
        completeTurn(process, "thread-1", "turn-control")
        awaitSnapshot(session) { it.phase == "ready" }
        val oldDiffId = session.snapshot().diffs.single().id
        session.resumeThread("thread-1")
        assertTrue(session.snapshot().diffs.isEmpty(), "Restoring a conversation must not retain the previous live diff")
        org.junit.jupiter.api.Assertions.assertThrows(CodemError.Validation::class.java) { session.openDiff(oldDiffId) }
        enqueueFileDiff(process, "src/App.kt")
        val fresh = awaitSnapshot(session) { it.diffs.singleOrNull()?.available == true }.diffs.single()
        assertTrue(fresh.id != oldDiffId)
        org.junit.jupiter.api.Assertions.assertThrows(CodemError.Validation::class.java) { session.openDiff(oldDiffId) }
        org.junit.jupiter.api.Assertions.assertThrows(CodemError.Validation::class.java) { session.changedFilePath(oldDiffId) }
        session.openDiff(fresh.id)
        session.applyViewAction(ViewAction.ManageThread("fork", "thread-1", "", "req-fork"))
        assertTrue(process.writes.any { JsonValue.parse(it).asObject().fields["method"]?.let { method -> (method as? JsonValue.Text)?.value == "thread/fork" } == true })
        session.newChat()
        assertTrue(session.snapshot().diffs.isEmpty())
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

    /** final_answer 是独立交付：保留摘要与附件标记，落盘时排在正文之后，正文不重复。 */
    @Test
    fun finalAnswerIsCommittedAfterTheStreamedText() {
        val process = ScriptedProcess()
        val session = session { startResponder(process, handshakeCapabilities()); process }
        session.connect()
        session.send("summarize", "req-final")
        fun notify(method: String, params: JsonValue.ObjectValue) =
            process.enqueue(encodeJson(JsonValue.obj("jsonrpc" to JsonValue.Text("2.0"), "method" to JsonValue.Text(method), "params" to params)))
        notify("item/agentMessage/delta", JsonValue.obj("threadId" to JsonValue.Text("thread-1"), "delta" to JsonValue.Text("Streamed notes")))
        notify(
            "item/completed",
            JsonValue.obj(
                "threadId" to JsonValue.Text("thread-1"),
                "turnId" to JsonValue.Text("turn-1"),
                "item" to JsonValue.parse(
                    """{"id":"final-1","type":"toolCall","status":"completed","tool":"final_answer","callId":"call-final","arguments":{"summary":"Delivered summary","artifacts":[{"kind":"file","title":"Report","path":"docs/report.md"}]}}""",
                ),
            ),
        )
        completeTurn(process, "thread-1", "turn-1")
        val done = awaitSnapshot(session) { snap -> snap.phase == "ready" && snap.messages.any { it.id == "turn-1:final:final-1" } }
        val turnMessages = done.messages.filter { it.turnId == "turn-1" && it.role == "assistant" }
        assertEquals(listOf("Streamed notes", "Delivered summary"), turnMessages.map { it.text })
        assertTrue(turnMessages.last().hasArtifacts)
        assertTrue(done.messages.none { it.label == "final_answer" })
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
        assertTrue(pending.pendingInteraction != "approval-1")
        assertEquals(pending.pendingPanel!!.id, pending.pendingInteraction)
        assertEquals("approval", pending.pendingPanel?.kind)
        assertEquals("Allow", pending.pendingPanel?.choices?.first { it.id == "choice-0" }?.label)

        session.applyViewAction(ViewAction.PanelReply(pending.pendingPanel!!.id, listOf("choice-0"), "", false))
        assertEquals(null, session.snapshot().pendingPanel)
        assertEquals(null, published.last().pendingPanel)
        val outcome = process.writes.map { JsonValue.parse(it).asObject() }
            .first { it.fields.containsKey("result") && it.fields["result"]?.asObject()?.fields?.containsKey("outcome") == true }
            .required("result").asObject().required("outcome").asObject()
        assertEquals("allow", outcome.required("optionId").asText())
    }

    @Test
    fun permissionCancellationInterruptsAndTerminalRevokesTheOldPanel() {
        val process = ScriptedProcess()
        val session = session { startResponder(process, handshakeCapabilities()); process }
        try {
            session.connect()
            session.send("approval", "req-cancel")
            process.enqueue(encodeJson(JsonValue.obj(
                "jsonrpc" to JsonValue.Text("2.0"), "id" to JsonValue.Text("approval-rpc"),
                "method" to JsonValue.Text("item/tool/requestApproval"),
                "params" to JsonValue.obj("threadId" to JsonValue.Text("thread-1"),
                    "options" to JsonValue.ArrayValue(listOf(JsonValue.obj("id" to JsonValue.Text("allow_once"))))),
            )))
            val panel = awaitSnapshot(session) { it.pendingPanel != null }.pendingPanel!!
            session.applyViewAction(ViewAction.PanelReply(panel.id, emptyList(), "", true))
            assertEquals("stopping", session.snapshot().phase)
            assertTrue(process.writes.any { it.contains("turn/interrupt") })
            completeTurn(process, "thread-1", "turn-1")
            assertEquals(null, awaitSnapshot(session) { it.phase == "ready" }.pendingPanel)
            org.junit.jupiter.api.Assertions.assertThrows(CodemError.Conflict::class.java) {
                session.applyViewAction(ViewAction.PanelReply(panel.id, listOf("choice-0"), "", false))
            }
        } finally { session.close().join() }
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

    /** 候选 Core 在清理后仍存活时，抛出的仍是 model/list 失败本身；关闭失败或超时作为 suppressed 附上，且不无限等待。 */
    @Test
    fun candidateFailureSurvivesACoreThatOutlivesItsCleanup() {
        for (hangs in listOf(false, true)) {
            val leak = CodemError.Process("CodeM App Server did not exit after stdin close, SIGTERM, and SIGKILL", stage = "close")
            val release = java.util.concurrent.CountDownLatch(1)
            val processes = mutableListOf<ScriptedProcess>()
            val session = session(
                wrap = { process ->
                    if (process !== processes.getOrNull(1)) process
                    else object : com.codem.intellij.core.ProcessHandleAdapter by process {
                        override fun shutdown(stageMs: Long) {
                            if (hangs) release.await() else throw leak
                        }
                    }
                },
            ) { process ->
                processes += process
                startResponder(process, handshakeCapabilities(), if (processes.size == 2) "model/list" else null)
                process
            }
            try {
                session.connect()
                val thrown = org.junit.jupiter.api.Assertions.assertTimeoutPreemptively<Throwable>(java.time.Duration.ofSeconds(10)) {
                    org.junit.jupiter.api.Assertions.assertThrows(Throwable::class.java) { session.chooseSpace("other") }
                }
                val chain = generateSequence(thrown) { it.cause }.toList()
                assertTrue(chain.none { it is java.util.concurrent.CompletionException }, "hangs=$hangs $thrown")
                assertTrue(chain.any { it.message?.contains("fixture rejected model/list") == true }, "hangs=$hangs $thrown")
                val suppressed = thrown.suppressed.single()
                if (hangs) assertTrue(suppressed is java.util.concurrent.TimeoutException, suppressed.toString())
                else org.junit.jupiter.api.Assertions.assertSame(leak, suppressed)
                assertEquals("ready", session.snapshot().phase, "hangs=$hangs")
            } finally {
                release.countDown()
                session.close().join()
                // The survivor never leaves through shutdown, and the session no longer tracks it.
                processes.forEach { it.destroy(true) }
            }
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
    fun rejectedImageSendKeepsComposerButRemovalReclaimsTheFile() {
        val process = ScriptedProcess()
        val session = session { startResponder(process, handshakeCapabilities(), failMethod = "turn/start"); process }
        try {
            session.connect()
            val id = session.attachPastedImages(listOf(ImageAttachment("image/png", byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10)))).single()
            org.junit.jupiter.api.Assertions.assertThrows(Exception::class.java) { session.send("image", "rejected-image", attachmentIds = listOf(id)) }
            val request = process.writes.map { JsonValue.parse(it).asObject() }.first { (it.fields["method"] as? JsonValue.Text)?.value == "turn/start" }
            val inputs = request.required("params").asObject().required("input").asArray().items.map { it.asObject() }
            val image = inputs.first { (it.fields["type"] as? JsonValue.Text)?.value == "localImage" }
            val path = Path.of(image.required("path").asText())
            assertEquals(id, session.snapshot().attachments.single().id)
            assertTrue(Files.exists(path))
            session.removeAttachment(id)
            assertTrue(!Files.exists(path), "A rejected request must not retain a removed image until disconnect")
        } finally { session.close().join() }
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

    @Test
    fun changedFileNavigationRequiresCurrentHandlesAndTrustedExistingFiles(@org.junit.jupiter.api.io.TempDir temp: Path) {
        val root = Files.createDirectory(temp.resolve("root"))
        val inside = Files.writeString(root.resolve("inside.txt"), "inside")
        val outside = Files.writeString(temp.resolve("outside.txt"), "outside")
        Files.createSymbolicLink(root.resolve("escape.txt"), outside)
        for (path in listOf("inside.txt", "../outside.txt", "escape.txt", "deleted.txt")) {
            val process = ScriptedProcess()
            val session = session(workingDirectory = root) { startResponder(process, handshakeCapabilities()); process }
            try {
                session.connect()
                session.resumeThread("thread-1")
                enqueueFileDiff(process, path)
                val diff = awaitSnapshot(session) { it.diffs.singleOrNull()?.available == true }.diffs.single()
                assertEquals(ViewAction.OpenChangedFile(diff.id), parseViewAction(JsonValue.obj("type" to JsonValue.Text("openChangedFile"), "id" to JsonValue.Text(diff.id))))
                if (path == "inside.txt") assertEquals(inside.toRealPath(), session.changedFilePath(diff.id))
                else org.junit.jupiter.api.Assertions.assertThrows(CodemError.Validation::class.java) { session.changedFilePath(diff.id) }
                session.newChat()
                org.junit.jupiter.api.Assertions.assertThrows(CodemError.Validation::class.java) { session.changedFilePath(diff.id) }
            } finally { session.close().get(5, java.util.concurrent.TimeUnit.SECONDS) }
        }
    }

    /**
     * 版本只由 mutate 递增：每个会改变会话状态的公开调用都必须升版本并推出它改出的快照。
     * 曾漏掉的 showHistory、loadCatalog、setTheme 等都在其中；只读或只转发给 Core 的调用不在此列。
     */
    @Test
    fun everyPublicMutationBumpsTheVersionAndPublishesIt() {
        val published = java.util.concurrent.CopyOnWriteArrayList<com.codem.intellij.webview.ChatSnapshot>()
        val processes = java.util.concurrent.CopyOnWriteArrayList<ScriptedProcess>()
        val extra = Files.createTempDirectory("codem-version-dir")
        val file = Files.writeString(Files.createTempFile("codem-version", ".txt"), "note")
        val session = session(
            onSnapshot = { published += it },
            historySource = HistorySource { _, _, cursor ->
                HistoryPage(listOf(HistoryTurn("sub-old", listOf("earlier user"), listOf("earlier assistant"), emptyList())), if (cursor == null) "cursor-2" else null)
            },
            selectionReader = object : SelectionReader {
                override fun current() = SelectionSnapshot("src/Main.kt", 3, 5, "val x = 1", 1, true)
            },
            attachmentStore = object : AttachmentStore {
                override fun validate(path: Path, kind: AttachmentStore.Kind): Path = path
            },
        ) { process -> processes += process; startResponder(process, handshakeCapabilities()); process }
        fun bumps(name: String, action: () -> Unit) {
            val before = session.snapshot().version
            action()
            val after = session.snapshot()
            assertTrue(after.version > before, "$name must bump the snapshot version")
            assertEquals(after.version, published.last().version, "$name must publish the state it changed")
        }
        try {
            bumps("connect") { session.connect() }
            bumps("saveDraft") { session.saveDraft("draft") }
            bumps("setTheme") { session.setTheme("dark") }
            bumps("setEffort") { session.setEffort("high") }
            bumps("chooseModel") { session.chooseModel("model-2") }
            bumps("setWorkMode") { session.setWorkMode("plan") }
            bumps("setPermission") { session.setPermission("auto") }
            bumps("rememberSendKey") { session.rememberSendKey("modEnter") }
            bumps("publishFileSearch") { session.publishFileSearch(com.codem.intellij.webview.FileSearchView("search-1", "loading")) }
            bumps("showHistory") { session.showHistory() }
            bumps("refreshHistory") { session.refreshHistory() }
            bumps("closeHistory") { session.closeHistory() }
            bumps("loadCatalog") { session.loadCatalog("skills") }
            bumps("selectSkill") { session.selectSkill("review") }
            bumps("setLiveSelection") { session.setLiveSelection("src/Main.kt", 3, 5, "val x = 1") }
            var selection = ""
            bumps("pinSelection") { selection = session.pinSelection()!! }
            bumps("removeSelection") { session.removeSelection(selection) }
            var attachment = ""
            bumps("attach") { attachment = session.attach(file, AttachmentStore.Kind.File) }
            bumps("removeAttachment") { session.removeAttachment(attachment) }
            bumps("attachPastedImages") { session.attachPastedImages(listOf(ImageAttachment("image/png", byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10)))) }
            bumps("addDirectory") { session.addDirectory(extra) }
            bumps("removeDirectory") { session.removeDirectory(session.snapshot().sessionTools.directories.single().id) }
            bumps("resumeThread") { session.resumeThread("thread-1") }
            bumps("loadOlderMessages") { session.loadOlderMessages() }
            bumps("readModes") { session.readModes() }
            bumps("setModes") { session.setModes(session.snapshot().modeRevision ?: 0, workMode = "normal") }
            bumps("listLiveTurns") { session.listLiveTurns() }
            bumps("listBackgroundTerminals") { session.listBackgroundTerminals() }
            bumps("terminateBackground") { session.terminateBackground("4242") }
            bumps("cleanBackground") { session.cleanBackground() }
            bumps("clearThread") { session.clearThread("op-1") }
            bumps("compactThread") { session.compactThread() }
            completeTurn(processes.last(), "thread-new", "turn-control")
            awaitSnapshot(session) { it.phase == "ready" }
            bumps("send") { session.send("hello", "req-version") }
            bumps("stop") { session.stop() }
            completeTurn(processes.last(), "thread-new", "turn-1")
            awaitSnapshot(session) { it.phase == "ready" }
            processes.last().enqueue(encodeJson(JsonValue.obj(
                "jsonrpc" to JsonValue.Text("2.0"), "id" to JsonValue.Text("approval-rpc"),
                "method" to JsonValue.Text("item/tool/requestApproval"),
                "params" to JsonValue.obj("threadId" to JsonValue.Text("thread-new"),
                    "options" to JsonValue.ArrayValue(listOf(JsonValue.obj("id" to JsonValue.Text("allow_once"))))),
            )))
            val panel = awaitSnapshot(session) { it.pendingPanel != null }.pendingPanel!!
            bumps("replyToInteraction") { session.replyToInteraction(panel.id, listOf("choice-0"), "", false) }
            bumps("archiveThread") { session.archiveThread(true) }
            session.resumeThread("thread-1")
            bumps("deleteThread") { session.deleteThread() }
            session.resumeThread("thread-1")
            bumps("newChat") { session.newChat() }
            bumps("chooseSpace") { session.chooseSpace("other") }
            bumps("close") { session.close().join() }
        } finally { session.close().join() }
    }

    /**
     * `core/backgroundTerminals.json` 也由 contracts.test.ts 交给 parseAppServerBackgroundTerminalList：
     * 接受的列表按 Core 顺序投影 processId 与 `alive`；被拒的列表以 InvalidFrame 失败，错误点名出错字段，
     * 并保留上一份有效列表。旧实现读不存在的 `inProgress`，把运行中的终端当成已退出，也接受缺 `alive` 的行；
     * 更早还在缺 processId 时用列表序号冒充进程号，终止时会把这个序号发给 Core。
     */
    @Test
    fun backgroundTerminalListingsFollowTheSharedContract() {
        val terminals = java.util.concurrent.atomic.AtomicReference<JsonValue>()
        val process = ScriptedProcess()
        val session = session {
            startResponder(process, handshakeCapabilities(), results = { method, _ -> if (method == "thread/backgroundTerminals/list") terminals.get() else null })
            process
        }
        val cases = backgroundCases()
        assertTrue(cases.any { it.requiredObject("expected", "case").requiredString("kind", "expected") == "accepted" })
        assertTrue(cases.any { it.requiredObject("expected", "case").requiredString("kind", "expected") == "protocol-error" })
        try {
            session.connect()
            session.resumeThread("thread-1")
            for (case in cases) {
                val name = case.requiredString("name", "case")
                val expected = case.requiredObject("expected", name)
                if (expected.requiredString("kind", name) == "accepted") {
                    val projected = expected.requiredArray("terminals", name).map {
                        val terminal = it.asObject(name)
                        terminal.requiredInt("processId", name).toString() to terminal.requiredBoolean("running", name)
                    }
                    terminals.set(case.required("result"))
                    assertEquals(projected, session.listBackgroundTerminals().map { it.id to it.inProgress }, name)
                    assertEquals(projected, session.snapshot().background.map { it.id to it.inProgress }, name)
                    continue
                }
                assertEquals("protocol-error", expected.requiredString("kind", name), name)
                assertEquals("invalid-frame", expected.requiredString("class", name), name)
                terminals.set(backgroundListing("running-terminal"))
                val lastGood = session.listBackgroundTerminals().map { it.id to it.inProgress }
                terminals.set(case.required("result"))
                val error = org.junit.jupiter.api.Assertions.assertThrows(CodemError.Protocol::class.java, { session.listBackgroundTerminals() }, name)
                assertEquals(CodemError.Class.InvalidFrame, error.errorClass, name)
                val field = expected.requiredString("field", name)
                assertTrue(error.message.orEmpty().contains(field), "$name must name $field: ${error.message}")
                assertEquals(lastGood, session.snapshot().background.map { it.id to it.inProgress }, "$name: a rejected listing keeps the last good one")
            }

            // Without a processId the old list offered "1"; terminating it must not reach Core.
            terminals.set(backgroundListing("process-id-missing"))
            org.junit.jupiter.api.Assertions.assertThrows(CodemError.Protocol::class.java) { session.terminateBackground("1") }
            assertTrue(process.writes.none { it.contains("thread/backgroundTerminals/terminate") })
        } finally { session.close().join() }
    }

    /**
     * 运行中的终端要显示为运行中，并能从界面终止。界面只在行的 inProgress 为真时给出“终止”，
     * 所以旧实现读 `inProgress` 时，Core 报告 `alive: true` 的终端显示“已退出”且无法终止。
     */
    @Test
    fun aRunningTerminalShowsAsRunningAndCanBeStopped() {
        val terminated = java.util.concurrent.atomic.AtomicBoolean(false)
        val process = ScriptedProcess()
        val session = session {
            startResponder(process, handshakeCapabilities(), results = { method, _ ->
                when (method) {
                    "thread/backgroundTerminals/list" -> backgroundListing(if (terminated.get()) "exited-terminal" else "running-terminal")
                    "thread/backgroundTerminals/terminate" -> JsonValue.ObjectValue(emptyMap()).also { terminated.set(true) }
                    else -> null
                }
            })
            process
        }
        try {
            session.connect()
            session.resumeThread("thread-1")
            session.applyViewAction(ViewAction.RefreshBackground)
            val shown = session.snapshot().background.single()
            assertEquals("4242", shown.id)
            assertTrue(shown.inProgress, "a terminal Core reports alive must show as running")
            val row = encodeChatSnapshot(session.snapshot()).requiredArray("background", "snapshot").single().asObject("snapshot.background[0]")
            assertEquals(JsonValue.Bool(true), row.required("inProgress"), "the view offers 终止 only for an inProgress row")

            session.applyViewAction(parseViewAction(JsonValue.obj("type" to JsonValue.Text("terminateBackground"), "id" to JsonValue.Text(shown.id))))
            val terminate = process.writes.map { JsonValue.parse(it).asObject() }.filter { it.stringOrNull("method") == "thread/backgroundTerminals/terminate" }
            assertEquals(1, terminate.size)
            assertEquals(
                JsonValue.obj("threadId" to JsonValue.Text("thread-1"), "processId" to JsonValue.NumberValue(4242.0, "4242")),
                terminate.single().required("params"),
            )
            val stopped = session.snapshot().background.single()
            assertEquals("4242", stopped.id)
            assertEquals(false, stopped.inProgress, "the listing after terminate reports the terminal as exited")
        } finally { session.close().join() }
    }

    /**
     * 与 host.ts threadSummary / thread/list 一致：preview 必须是字符串、archived 必须是布尔值、total 必须是非负整数。
     * 旧实现把错类型的 preview 显示成“未命名会话”、archived 当作 false，total 1.5 截断成 1。
     */
    @Test
    fun threadListRequiresTypedPreviewArchivedAndTotal() {
        val listing = java.util.concurrent.atomic.AtomicReference<JsonValue>()
        val process = ScriptedProcess()
        val session = session {
            startResponder(process, handshakeCapabilities(), results = { method, _ -> if (method == "thread/list") listing.get() else null })
            process
        }
        fun page(total: JsonValue = JsonValue.NumberValue(1.0, "1"), vararg fields: Pair<String, JsonValue?>): JsonValue.ObjectValue {
            val thread = linkedMapOf<String, JsonValue>("id" to JsonValue.Text("thread-1"), "preview" to JsonValue.Text("昨天的问题"), "archived" to JsonValue.Bool(false))
            for ((key, value) in fields) if (value == null) thread.remove(key) else thread[key] = value
            return JsonValue.obj("threads" to JsonValue.ArrayValue(listOf(JsonValue.ObjectValue(thread))), "nextCursor" to JsonValue.Null, "total" to total)
        }
        try {
            session.connect()
            listing.set(page(JsonValue.NumberValue(1.0, "1"), "preview" to JsonValue.Text("  "), "archived" to JsonValue.Bool(true)))
            session.showHistory()
            val blank = session.snapshot().history
            assertEquals(null, blank.error)
            assertEquals("未命名会话", blank.entries.single().title)
            assertEquals(true, blank.entries.single().archived)

            for (fields in listOf(
                arrayOf("preview" to JsonValue.NumberValue(42.0, "42")),
                arrayOf("preview" to JsonValue.Null),
                arrayOf("preview" to null),
                arrayOf("archived" to JsonValue.Text("false")),
                arrayOf("archived" to null),
            )) {
                listing.set(page(JsonValue.NumberValue(1.0, "1"), *fields))
                session.showHistory()
                val failed = session.snapshot().history
                assertEquals("无法加载会话列表，请刷新重试。", failed.error, fields.toList().toString())
                assertEquals(false, failed.loading)
            }

            for (total in listOf(JsonValue.NumberValue(1.5, "1.5"), JsonValue.NumberValue(-1.0, "-1"), JsonValue.Text("1"), JsonValue.Null)) {
                listing.set(page(total))
                val error = org.junit.jupiter.api.Assertions.assertThrows(CodemError.Protocol::class.java, { session.listThreads() }, total.toString())
                assertEquals(CodemError.Class.InvalidFrame, error.errorClass, total.toString())
            }
        } finally { session.close().join() }
    }

    /** 与 host.ts listModels 一致：supportsVision 必须是布尔值。旧实现把缺失或错类型当作“不支持图片”。 */
    @Test
    fun modelListRequiresABooleanSupportsVision() {
        fun connectWith(vararg vision: JsonValue?): ProjectSession {
            val listing = JsonValue.obj(
                "activeModel" to JsonValue.Text("model-0"),
                "models" to JsonValue.ArrayValue(vision.mapIndexed { index, value ->
                    JsonValue.ObjectValue(listOfNotNull("id" to JsonValue.Text("model-$index"), value?.let { "supportsVision" to it }).toMap())
                }),
            )
            val process = ScriptedProcess()
            return session {
                startResponder(process, handshakeCapabilities(), results = { method, _ -> if (method == "model/list") listing else null })
                process
            }
        }
        val valid = connectWith(JsonValue.Bool(true), JsonValue.Bool(false))
        try {
            valid.connect()
            assertEquals(listOf("支持图片", ""), valid.snapshot().composerCatalog.models.map { it.description })
        } finally { valid.close().join() }
        for (vision in listOf(JsonValue.Text("true"), JsonValue.Null, null)) {
            val session = connectWith(JsonValue.Bool(true), vision)
            try {
                org.junit.jupiter.api.Assertions.assertThrows(CodemError::class.java, { session.connect() }, vision.toString())
                assertTrue(session.snapshot().phase != "ready", vision.toString())
                assertTrue(session.snapshot().composerCatalog.models.none { it.label == "model-1" }, vision.toString())
            } finally { session.close().join() }
        }
    }

    /**
     * 与 modes.ts parseAppServerModes 一致：回包必须带 threadId 与 state 对象，revision/permissionEpoch 是非负整数。
     * 旧实现接受缺 threadId 或不带 state 的扁平回包，并把 1.5 截断成 1、接受负数。
     */
    @Test
    fun modeResponsesRequireThreadStateAndNonNegativeCounters() {
        val response = java.util.concurrent.atomic.AtomicReference<JsonValue>()
        val process = ScriptedProcess()
        val session = session {
            startResponder(process, handshakeCapabilities(), results = { method, _ -> if (method == "thread/mode/read") response.get() else null })
            process
        }
        fun state(revision: JsonValue = JsonValue.NumberValue(3.0, "3"), epoch: JsonValue = JsonValue.NumberValue(0.0, "0")) = JsonValue.obj(
            "revision" to revision,
            "permissionEpoch" to epoch,
            "permissionMode" to JsonValue.Text("auto"),
            "workMode" to JsonValue.Text("normal"),
        )
        try {
            session.connect()
            session.resumeThread("thread-1")
            response.set(JsonValue.obj("threadId" to JsonValue.Text("thread-1"), "state" to state()))
            assertEquals(3, session.readModes().revision)

            val invalid = listOf(
                JsonValue.obj("state" to state()),
                JsonValue.obj("threadId" to JsonValue.Text("thread-other"), "state" to state()),
                JsonValue.ObjectValue(state().fields + ("threadId" to JsonValue.Text("thread-1"))),
                JsonValue.obj("threadId" to JsonValue.Text("thread-1"), "state" to JsonValue.Text("auto")),
                JsonValue.obj("threadId" to JsonValue.Text("thread-1"), "state" to state(revision = JsonValue.NumberValue(4.5, "4.5"))),
                JsonValue.obj("threadId" to JsonValue.Text("thread-1"), "state" to state(revision = JsonValue.NumberValue(-1.0, "-1"))),
                JsonValue.obj("threadId" to JsonValue.Text("thread-1"), "state" to state(epoch = JsonValue.NumberValue(-1.0, "-1"))),
                JsonValue.obj("threadId" to JsonValue.Text("thread-1"), "state" to state(epoch = JsonValue.Text("0"))),
            )
            for (result in invalid) {
                response.set(result)
                val error = org.junit.jupiter.api.Assertions.assertThrows(CodemError.Protocol::class.java, { session.readModes() }, result.toString())
                assertEquals(CodemError.Class.InvalidFrame, error.errorClass, result.toString())
                assertEquals(3, session.snapshot().modeRevision, "a rejected response keeps the accepted state")
            }
        } finally { session.close().join() }
    }

    /** 与 host.ts 一致：thread/status/changed 的 status 必须是字符串。旧实现把错类型当作没有状态，连接照常。 */
    @Test
    fun threadStatusChangeRequiresAStringStatus() {
        for (status in listOf(JsonValue.NumberValue(42.0, "42"), JsonValue.Null, null)) {
            val process = ScriptedProcess()
            val session = session {
                startResponder(process, handshakeCapabilities())
                process
            }
            try {
                session.connect()
                enqueueNotification(process, "thread/status/changed", JsonValue.obj("status" to JsonValue.Text("idle")))
                awaitSnapshot(session) { it.capabilities.threadStatus == "idle" }
                enqueueNotification(process, "thread/status/changed", JsonValue.ObjectValue(listOfNotNull(status?.let { "status" to it }).toMap()))
                val failed = awaitSnapshot(session) { it.phase == "failed" }
                assertEquals(true, failed.canRetry, status.toString())
            } finally { session.close().join() }
        }
    }

    /** 历史列表读取失败：loading 必须结束并推给界面，面板给出可读错误；刷新成功后恢复条目并清掉错误。 */
    @Test
    fun failedHistoryLoadClearsLoadingAndRefreshRecovers() {
        val published = java.util.concurrent.CopyOnWriteArrayList<com.codem.intellij.webview.ChatSnapshot>()
        val failList = java.util.concurrent.atomic.AtomicBoolean(true)
        val process = ScriptedProcess()
        val session = session(onSnapshot = { published += it }) {
            startResponder(process, handshakeCapabilities(), shouldFail = { it == "thread/list" && failList.get() })
            process
        }
        try {
            session.connect()
            session.showHistory()
            val failed = session.snapshot().history
            assertEquals(true, failed.open)
            assertEquals(false, failed.loading)
            assertEquals("无法加载会话列表，请刷新重试。", failed.error)
            assertTrue(published.any { it.history.loading }, "loading must be shown while the list is read")
            assertEquals(failed, published.last().history)
            assertEquals("ready", session.snapshot().phase)

            failList.set(false)
            session.refreshHistory()
            val recovered = session.snapshot().history
            assertEquals(false, recovered.loading)
            assertEquals(null, recovered.error)
            assertEquals("昨天的问题", recovered.entries.single().title)
            assertEquals(recovered, published.last().history)
        } finally { session.close().join() }
    }

    /**
     * 回包锁内判定、锁外写：每次写入对 Core 请求的回包时，另一线程都必须能立即拿到会话锁。
     * 覆盖用户回复、读线程拒绝未知请求、turn/completed 撤销和关闭撤销四条路径。
     */
    @Test
    fun coreRepliesAreWrittenOutsideTheSessionLock() {
        val holder = java.util.concurrent.atomic.AtomicReference<ProjectSession>()
        val replies = java.util.concurrent.CopyOnWriteArrayList<Pair<String, Boolean>>()
        val processes = java.util.concurrent.CopyOnWriteArrayList<ScriptedProcess>()
        val session = session(
            wrap = { process -> LockProbeProcess(process) { id -> replies += id to lockIsFree(holder.get()) } },
        ) { process ->
            processes += process
            startResponder(process, handshakeCapabilities())
            process
        }
        holder.set(session)
        fun requestApproval(id: String) = processes.single().enqueue(encodeJson(JsonValue.obj(
            "jsonrpc" to JsonValue.Text("2.0"), "id" to JsonValue.Text(id),
            "method" to JsonValue.Text("item/tool/requestApproval"),
            "params" to JsonValue.obj("threadId" to JsonValue.Text("thread-1"), "requestId" to JsonValue.Text(id),
                "options" to JsonValue.ArrayValue(listOf(JsonValue.obj("id" to JsonValue.Text("allow_once"))))),
        )))
        try {
            session.connect()
            session.send("hello", "req-lock")
            requestApproval("approval-replied")
            val panel = awaitSnapshot(session) { it.pendingPanel != null }.pendingPanel!!
            session.replyToInteraction(panel.id, listOf("choice-0"), "", false)

            processes.single().enqueue(encodeJson(JsonValue.obj(
                "jsonrpc" to JsonValue.Text("2.0"), "id" to JsonValue.Text("unsupported"),
                "method" to JsonValue.Text("item/unknown/request"), "params" to JsonValue.ObjectValue(emptyMap()),
            )))
            awaitCondition { replies.any { it.first == "unsupported" } }

            requestApproval("approval-revoked")
            awaitSnapshot(session) { it.pendingPanel != null }
            completeTurn(processes.single(), "thread-1", "turn-1")
            awaitCondition { replies.any { it.first == "approval-revoked" } }

            requestApproval("approval-closed")
            awaitSnapshot(session) { it.pendingPanel != null }
            session.close().join()

            assertEquals(listOf("approval-replied", "unsupported", "approval-revoked", "approval-closed"), replies.map { it.first })
            assertEquals(emptyList<String>(), replies.filterNot { it.second }.map { it.first }, "these replies were written while the session lock was held")
        } finally { session.close().join() }
    }

    private fun lockIsFree(session: ProjectSession): Boolean {
        val read = java.util.concurrent.CompletableFuture.supplyAsync { session.snapshot() }
        return try {
            read.get(1, java.util.concurrent.TimeUnit.SECONDS)
            true
        } catch (_: java.util.concurrent.TimeoutException) {
            false
        }
    }

    /** Reports every response the session writes to Core (a frame with an id and no method) before passing it on. */
    private class LockProbeProcess(
        private val inner: ScriptedProcess,
        private val onReply: (String) -> Unit,
    ) : com.codem.intellij.core.ProcessHandleAdapter by inner {
        override fun writeLine(line: String) {
            val frame = JsonValue.parse(line).asObject()
            if ("method" !in frame.fields) onReply((frame.fields["id"] as? JsonValue.Text)?.value ?: frame.fields["id"].toString())
            inner.writeLine(line)
        }
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
                                    JsonValue.obj("kind" to JsonValue.Text("context"), "old_line" to JsonValue.NumberValue(1.0, "1"), "new_line" to JsonValue.NumberValue(1.0, "1"), "text" to JsonValue.Text("val kept = 1")),
                                    JsonValue.obj("kind" to JsonValue.Text("delete"), "old_line" to JsonValue.NumberValue(2.0, "2"), "new_line" to JsonValue.Null, "text" to JsonValue.Text("val before = 2")),
                                    JsonValue.obj("kind" to JsonValue.Text("insert"), "old_line" to JsonValue.Null, "new_line" to JsonValue.NumberValue(2.0, "2"), "text" to JsonValue.Text("val after = 2")),
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

    private fun awaitCondition(condition: () -> Boolean) {
        repeat(80) {
            if (condition()) return
            Thread.sleep(15)
        }
        throw AssertionError("condition was not reached")
    }

    private fun enqueueNotification(process: ScriptedProcess, method: String, params: JsonValue.ObjectValue) {
        process.enqueue(encodeJson(JsonValue.obj(
            "jsonrpc" to JsonValue.Text("2.0"),
            "method" to JsonValue.Text(method),
            "params" to params,
        )))
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
        workingDirectory: Path? = null,
        auth: AuthGateway = StubAuth(),
        spaceOverride: SpaceGateway = StubSpace(),
        historySource: HistorySource? = null,
        selectionReader: SelectionReader? = null,
        attachmentStore: AttachmentStore? = null,
        directoryPicker: DirectoryPicker? = null,
        diffPresenter: com.codem.intellij.ide.DiffPresenter = com.codem.intellij.ide.NoopDiffPresenter,
        onSnapshot: ((com.codem.intellij.webview.ChatSnapshot) -> Unit)? = null,
        wrap: (ScriptedProcess) -> com.codem.intellij.core.ProcessHandleAdapter = { it },
        factory: (ScriptedProcess) -> ScriptedProcess,
    ): ProjectSession {
        val cwd = workingDirectory ?: Files.createTempDirectory("codem-session-cwd")
        val file = Files.createTempFile("codem-core", "")
        Files.writeString(file, "x")
        val target = RuntimeLocator.targets.values.first()
        val runtime = ResolvedRuntime(target, RuntimeLocator.CORE_VERSION, RuntimeLocator.CLI_VERSION, file, file, file, file, "00")
        return ProjectSession(
            runtime = runtime,
            workingDirectory = cwd,
            trusted = trusted,
            timeouts = Timeouts(initializeMs = 2_000, rpcMs = 2_000, closeStageMs = 200),
            processFactory = { _, _, _ -> wrap(factory(ScriptedProcess())) },
            authOverride = auth,
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
        shouldFail: (String) -> Boolean = { it == failMethod },
        results: (String, JsonValue.ObjectValue) -> JsonValue? = { _, _ -> null },
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
                if (shouldFail(method)) {
                    process.enqueue(encodeJson(JsonValue.obj(
                        "jsonrpc" to JsonValue.Text("2.0"), "id" to id,
                        "error" to JsonValue.obj("code" to JsonValue.NumberValue(-32000.0, "-32000"), "message" to JsonValue.Text("fixture rejected $method")),
                    )))
                    continue
                }
                val result = results(method, params) ?: when (method) {
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
                    "thread/backgroundTerminals/list" -> backgroundListing("running-terminal")
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

    /** A complete thread/backgroundTerminals/list result from the sample the TypeScript contract test also reads. */
    private fun backgroundListing(name: String): JsonValue =
        backgroundCases().single { it.requiredString("name", "core/backgroundTerminals.json case") == name }.required("result")

    private fun backgroundCases(): List<JsonValue.ObjectValue> = ContractFixtures.cases("core/backgroundTerminals.json")

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

    /** 默认已登录；置 loggedIn = false 模拟登录已失效，此后按 AuthClient 规则拒绝启动。 */
    private class StubAuth : AuthGateway {
        @Volatile var loggedIn = true
        override fun status() = AuthStatus(loggedIn, "cli", loggedIn, null, null, "u1", "User")
        override fun assertAuthenticated(status: AuthStatus) {
            if (!status.loggedIn) throw CodemError.Authentication("CodeM login is required before starting App Server threads")
        }
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
