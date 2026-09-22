package com.codem.intellij.session

import com.codem.intellij.account.AuthClient
import com.codem.intellij.account.AuthGateway
import com.codem.intellij.account.AuthStatus
import com.codem.intellij.account.PreparedSpace
import com.codem.intellij.account.SpaceBroker
import com.codem.intellij.account.SpaceGateway
import com.codem.intellij.account.SpaceList
import com.codem.intellij.account.SpacePreparation
import com.codem.intellij.ide.AttachmentStore
import com.codem.intellij.ide.DiffPresenter
import com.codem.intellij.ide.DirectoryPicker
import com.codem.intellij.ide.HistorySource
import com.codem.intellij.ide.NoopDiffPresenter
import com.codem.intellij.ide.PathGuard
import com.codem.intellij.ide.SelectionReader
import com.codem.intellij.ide.WorkspaceTrustPolicy
import com.codem.intellij.core.ClientInfo
import com.codem.intellij.core.CodemError
import com.codem.intellij.core.CoreProcess
import com.codem.intellij.core.JsonValue
import com.codem.intellij.core.KnownNotifications
import com.codem.intellij.core.ProcessHandleAdapter
import com.codem.intellij.core.ResolvedRuntime
import com.codem.intellij.core.RpcPeer
import com.codem.intellij.core.RpcRequest
import com.codem.intellij.core.Timeouts
import com.codem.intellij.core.defaultProcess
import com.codem.intellij.core.encodeJson
import com.codem.intellij.core.RpcNotification
import com.codem.intellij.webview.AccountProfileView
import com.codem.intellij.webview.AccountView
import com.codem.intellij.webview.AttachmentView
import com.codem.intellij.webview.BackgroundView
import com.codem.intellij.webview.CapabilityView
import com.codem.intellij.webview.CatalogRowView
import com.codem.intellij.webview.CatalogSnapshotView
import com.codem.intellij.webview.ChatMessageView
import com.codem.intellij.webview.ChatSnapshot
import com.codem.intellij.webview.ComposerCatalogView
import com.codem.intellij.webview.ComposerChoiceView
import com.codem.intellij.webview.DiffView
import com.codem.intellij.webview.DirectoryView
import com.codem.intellij.webview.PlanItemView
import com.codem.intellij.webview.SelectionView
import com.codem.intellij.webview.SessionToolsView
import com.codem.intellij.webview.SkillView
import com.codem.intellij.webview.TurnTimingView
import com.codem.intellij.webview.UsageView
import com.codem.intellij.webview.SubmissionReceiptView
import com.codem.intellij.webview.ViewAction
import com.codem.intellij.webview.initialSnapshot
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

data class ThreadSettings(
    val model: String = "codem-router/auto",
    val intelligence: String = "medium",
    val permissionMode: String = "auto",
    val workMode: String = "default",
)

data class SessionDraft(var text: String = "", var attachments: List<String> = emptyList())

data class ThreadListPage(val threads: List<JsonValue.ObjectValue>, val nextCursor: String?, val total: Int)

data class ModeState(
    val revision: Int = 0,
    val permissionEpoch: Int = 0,
    val permissionMode: String = "default",
    val workMode: String = "normal",
)

data class SelectionHandle(
    val id: String,
    val label: String,
    val text: String,
    val startLine: Int = 1,
    val endLine: Int = 1,
    val pinned: Boolean = true,
)

data class ListedModel(val handle: String, val modelId: String, val supportsVision: Boolean)
data class DirectoryRef(val id: String, val label: String, val path: Path)

/**
 * 每个规范化 cwd 一个当前 Core。会话状态只有一个串行所有者。
 * 耗时 I/O 在锁外执行，返回时检查连接代次。
 *
 * 更改要点：发送把 user 写入 messages；通知经 onSnapshot 推界面；
 * 思考/工具进 messages；activity 只作中间进度；turn/completed 才落正文。
 */
class ProjectSession(
    private val runtime: ResolvedRuntime,
    private val workingDirectory: Path,
    private val trusted: Boolean,
    private val timeouts: Timeouts = Timeouts(),
    private val processFactory: ((List<String>, Path, Map<String, String>) -> ProcessHandleAdapter)? = null,
    private val authOverride: AuthGateway? = null,
    private val spaceOverride: SpaceGateway? = null,
    private val selectionReader: SelectionReader? = null,
    private val attachmentStore: AttachmentStore? = null,
    private val diffPresenter: DiffPresenter = NoopDiffPresenter,
    private val historySource: HistorySource? = null,
    private val directoryPicker: DirectoryPicker? = null,
    private val onSnapshot: ((ChatSnapshot) -> Unit)? = null,
) {
    private val lock = ReentrantLock()
    private val turnChanged = lock.newCondition()
    private var threadChangeGeneration: Long? = null
    private val generation = AtomicLong(0)
    private val connectionIds = AtomicLong(0)
    private var pendingConnection: CompletableFuture<Void>? = null
    private val budget = CallBudget()
    private val turns = TurnAccumulator()
    private val interactions = InteractionRouter()
    private val draft = SessionDraft()
    private var phase = ConnectionPhase.Disconnected
    private var auth: AuthStatus? = null
    private var spaces: SpaceList? = null
    private var space: PreparedSpace? = null
    private var core: CoreProcess? = null
    private var threadId: String? = null
    private var settings = ThreadSettings()
    private var modes = ModeState()
    private var modesValid = false
    private var lastThreadId: String? = null
    private var historyCursor: String? = null
    private var hasOlder = false
    private var selectedSkill: String? = null
    private var skills = listOf<SkillView>()
    private var catalogKind: String? = null
    private var catalogRows = listOf<CatalogRowView>()
    private var directories = mutableListOf<DirectoryRef>()
    private val attachments = AttachmentCollection(attachmentStore)
    private var selections = mutableListOf<SelectionHandle>()
    private var liveSelection: SelectionHandle? = null
    private var dismissedLiveLabel: String? = null
    private var listedModels = listOf<ListedModel>()
    private var historyList = com.codem.intellij.webview.HistoryListView()
    private var threadListCursor: String? = null
    private var fileSearch: com.codem.intellij.webview.FileSearchView? = null
    private var sendKey = "enter"
    private var diffs = mutableListOf<DiffView>()
    // 行序即 diff id 序；内容只在 Core 给出 hunks 后才有，UI 侧永远拿不到路径。
    private val diffPaths = mutableListOf<String>()
    private val diffContents = mutableMapOf<String, FileDiffContent>()
    private var fileDiffs = FileDiffAssembler()
    private var background = listOf<BackgroundView>()
    private var threadStatus: String? = null
    private var theme = "light"
    private var sideQuestionId: String? = null
    private var historyMessages = mutableListOf<ChatMessageView>()
    private var turnTimings = mutableListOf<TurnTimingView>()
    private var notice: SessionNotice? = null
    private var submission: SubmissionReceiptView? = null
    private var snapshotVersion = 0L
    private val retiring = mutableListOf<CoreProcess>()

    fun snapshot(): ChatSnapshot = lock.withLock {
        initialSnapshot().copy(
            phase = when (phase) {
                ConnectionPhase.Disconnected -> "disconnected"
                ConnectionPhase.Authenticating, ConnectionPhase.PreparingSpace, ConnectionPhase.Starting -> "connecting"
                ConnectionPhase.Ready -> if (threadChangeGeneration != null) "stopping" else when (turns.current?.phase) {
                    TurnPhase.Submitting -> "sending"
                    TurnPhase.Running -> "running"
                    TurnPhase.Interrupting -> "stopping"
                    else -> "ready"
                }
                ConnectionPhase.Failed -> "failed"
                ConnectionPhase.Closing -> "closing"
            },
            workspace = workingDirectory.fileName?.toString(),
            space = space?.displayName,
            threadId = threadId,
            resumeThreadId = lastThreadId,
            model = settings.model,
            effort = settings.intelligence,
            permission = settings.permissionMode,
            workMode = settings.workMode,
            modeRevision = modes.revision.takeIf { threadId != null },
            notice = notice?.message,
            submission = submission,
            version = snapshotVersion,
            theme = theme,
            hasOlderMessages = hasOlder,
            historyNeedsRefresh = false,
            // 流式走 assistantText；思考/工具走 messages；turn/completed 后正文进 messages。
            assistantText = when (turns.current?.phase) {
                TurnPhase.Submitting, TurnPhase.Running, TurnPhase.Interrupting -> turns.current?.text?.toString() ?: ""
                else -> ""
            },
            messages = historyMessages + turns.liveMessages(),
            turnTimings = turnTimings.toList(),
            pendingInteraction = interactions.panelView()?.id,
            pendingPanel = interactions.panelView(),
            canRetry = phase == ConnectionPhase.Failed && notice?.recoverable == true,
            canResume = lastThreadId != null && threadId == null && phase == ConnectionPhase.Ready && idleTurnLocked(),
            canLoadOlder = hasOlder && threadId != null && phase == ConnectionPhase.Ready,
            composerCatalog = ComposerCatalogView(
                models = modelChoicesLocked(),
                spaces = spaces?.spaces.orEmpty().map { listed ->
                    ComposerChoiceView(
                        listed.projectKey,
                        listed.displayName,
                        "",
                        listed.projectKey == spaces?.current || listed.projectKey == space?.projectKey,
                    )
                },
            ),
            capabilities = capabilityViewLocked(),
            sessionTools = SessionToolsView(
                skills = skills,
                selectedSkill = selectedSkill,
                catalog = catalogKind?.let { CatalogSnapshotView(it, catalogRows, true) },
                directories = directories.map { DirectoryView(it.id, it.label) },
                busy = null,
            ),
            attachments = attachments.visible().map { AttachmentView(it.id, it.label, it.kind) },
            selections = selectionViewsLocked(),
            history = historyList,
            fileSearch = fileSearch,
            sendKey = sendKey,
            diffs = diffs.toList(),
            background = background,
            account = accountViewLocked(),
        )
    }

    private fun accountViewLocked(): AccountView {
        val status = auth ?: return AccountView(status = "checking")
        if (!status.loggedIn) return AccountView(status = "signedOut", notice = null)
        return AccountView(
            status = "signedIn",
            refreshing = false,
            notice = null,
            profile = AccountProfileView(
                displayName = status.displayName,
                userId = status.userId,
                tenantId = status.tenantId,
                authMethod = status.authMethod,
            ),
        )
    }

    fun callBudget(): Map<String, Int> = lock.withLock { budget.snapshot() }

    fun saveDraft(text: String) {
        lock.withLock { draft.text = text }
    }

    fun currentDraft(): String = lock.withLock { draft.text }

    /**
     * 已登录且可自动选空间：auth/list/prepare 各 1，Core 1。
     * 必须等用户选空间时先关 broker，选择后再重新 auth/prepare。
     * 新 Core 握手和目录读取成功后，才提交替换并退役旧连接。
     */
    fun connect(requestedSpace: String? = null): ChatSnapshot {
        WorkspaceTrustPolicy.requireTrusted(trusted, WorkspaceTrustPolicy.START_CORE)
        val preflightGeneration = beginPreflight(ConnectionPhase.Authenticating)
        try {
            val authClient = authOverride ?: AuthClient(runtime, workingDirectory, timeouts = timeouts)
            val status = authClient.status()
            bump { auth += 1 }
            authClient.assertAuthenticated(status)
            lock.withLock {
                assertGeneration(preflightGeneration)
                phase = ConnectionPhase.PreparingSpace
            }
            val broker = spaceOverride ?: SpaceBroker(runtime, workingDirectory, timeouts = timeouts)
            val prepared = broker.prepareInitial(requestedSpace)
            bump { list += 1 }
            when (prepared) {
                is SpacePreparation.SelectionRequired -> {
                    bump { prepare += 0 }
                    // 还没选空间就不该动现有连接：仍在跑的 Core 保持 ready。
                    lock.withLock {
                        assertGeneration(preflightGeneration)
                        auth = status
                        spaces = prepared.catalog
                        phase = if (core != null) ConnectionPhase.Ready else ConnectionPhase.Disconnected
                        notice = SessionNotice("Select a space to continue", true)
                    }
                    emitSnapshot()
                    return snapshot()
                }
                is SpacePreparation.Prepared -> {
                    bump { prepare += 1 }
                    replaceConnection(preflightGeneration, prepared.catalog, prepared.space, broker, status)
                }
            }
        } catch (error: Throwable) {
            failConnection(preflightGeneration, error, "CodeM connection failed")
            throw error
        } finally {
            finishPreflight()
        }
        emitSnapshot()
        return snapshot()
    }

    /**
     * 切空间在旧连接仍然存活时完成；认证、准备、握手和目录任一失败都回到原连接，
     * 不把用户从一个能用的会话推进无连接状态。
     */
    fun chooseSpace(projectKey: String): ChatSnapshot {
        WorkspaceTrustPolicy.requireTrusted(trusted, WorkspaceTrustPolicy.START_CORE)
        val preflightGeneration = beginPreflight(ConnectionPhase.Authenticating)
        try {
            val authClient = authOverride ?: AuthClient(runtime, workingDirectory, timeouts = timeouts)
            val status = authClient.status()
            bump { auth += 1 }
            authClient.assertAuthenticated(status)
            val broker = spaceOverride ?: SpaceBroker(runtime, workingDirectory, timeouts = timeouts)
            val space = broker.prepare(projectKey)
            bump { prepare += 1 }
            val catalog = spaces ?: SpaceList(space.projectKey, listOf(com.codem.intellij.account.Space(space.projectKey, space.displayName)))
            replaceConnection(preflightGeneration, catalog, space, broker, status)
        } catch (error: Throwable) {
            failConnection(preflightGeneration, error, "CodeM space selection failed")
            throw error
        } finally {
            finishPreflight()
        }
        emitSnapshot()
        return snapshot()
    }

    fun send(
        text: String,
        requestId: String,
        skillName: String? = null,
        attachmentIds: List<String> = emptyList(),
        selectionIds: List<String> = emptyList(),
    ): String = submit(requestId) {
        sendToCore(text, requestId, skillName, attachmentIds, selectionIds)
    }

    private fun sendToCore(text: String, requestId: String, skillName: String?, attachmentIds: List<String>, selectionIds: List<String>): String {
        WorkspaceTrustPolicy.requireTrusted(trusted, WorkspaceTrustPolicy.SEND_TURN)
        val trimmed = text.trim()
        if (trimmed.isEmpty()) throw CodemError.Validation("CodeM send text must be non-empty")
        val (coreProcess, currentThread, currentGeneration) = lock.withLock {
            if (phase != ConnectionPhase.Ready || core == null) throw CodemError.Conflict("CodeM is not ready")
            if (threadChangeGeneration != null) throw CodemError.Conflict("CodeM is switching conversations")
            val turnPhase = turns.current?.phase
            if (turnPhase == TurnPhase.Submitting || turnPhase == TurnPhase.Running || turnPhase == TurnPhase.Interrupting) {
                throw CodemError.Conflict("CodeM submission is already in progress")
            }
            turns.beginSubmit(requestId)
            notice = null
            historyMessages += ChatMessageView(requestId, "user", trimmed, turnId = requestId)
            snapshotVersion += 1
            Triple(core!!, threadId, generation.get())
        }
        emitSnapshot()
        return try {
            val activeThread = currentThread ?: startThread(coreProcess)
            lock.withLock {
                assertGeneration(currentGeneration)
                bindThreadLocked(activeThread)
            }
            if (skillName != null && attachmentIds.isNotEmpty()) ThreadCommands.rejectSkillWithAttachments()
            val result = coreProcess.request(
                "turn/start",
                turnStartParams(activeThread, requestId, text, skillName, attachmentIds, selectionIds),
            ).get(timeouts.rpcMs, TimeUnit.MILLISECONDS).asObject()
            bump { rpc += 1 }
            val turnId = ((result.fields["turn"] as? JsonValue.ObjectValue)?.fields?.get("id") as? JsonValue.Text)?.value
                ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "turn/start omitted turn.id")
            lock.withLock {
                assertGeneration(currentGeneration)
                turns.acceptStarted(turnId)
                attachments.consume(attachmentIds)
                recordTurnTimingLocked("turn/started")
                snapshotVersion += 1
            }
            emitSnapshot()
            turnId
        } catch (error: Throwable) {
            lock.withLock {
                if (generation.get() == currentGeneration) {
                    turns.clearIfTerminal()
                    if (turns.current?.phase == TurnPhase.Submitting) turns.resetActive()
                    historyMessages.removeAll { it.id == requestId }
                    notice = SessionNotice(SafeNotice.from(error, "CodeM send failed"), true)
                    snapshotVersion += 1
                }
            }
            emitSnapshot()
            throw error
        }
    }

    /** Receipt means the Core operation returned successfully, never just an optimistic UI row. */
    private fun <T> submit(requestId: String, operation: () -> T): T {
        return try {
            val result = operation()
            recordSubmission(requestId, true)
            result
        } catch (error: Throwable) {
            lock.withLock { notice = SessionNotice(SafeNotice.from(error, "CodeM send failed"), true) }
            recordSubmission(requestId, false)
            throw error
        }
    }

    private fun recordSubmission(requestId: String, accepted: Boolean) {
        lock.withLock {
            submission = SubmissionReceiptView(requestId, accepted)
            snapshotVersion += 1
        }
        emitSnapshot()
    }

    fun stop() = interruptTurn(requireActive = true)

    private fun interruptTurn(requireActive: Boolean) {
        val (coreProcess, activeThread, turnId, currentGeneration) = lock.withLock {
            if (phase != ConnectionPhase.Ready || core == null) throw CodemError.Conflict("CodeM is not ready")
            if (!requireActive && turns.current?.phase != TurnPhase.Running) return
            val turn = turns.current ?: throw CodemError.Conflict("CodeM turn/interrupt has no active turn")
            turns.markInterrupting()
            Quadruple(core!!, threadId ?: throw CodemError.Conflict("no thread"), turn.turnId, generation.get())
        }
        try {
            val result = coreProcess.request("turn/interrupt", JsonValue.obj("threadId" to JsonValue.Text(activeThread), "turnId" to JsonValue.Text(turnId)))
                .get(timeouts.rpcMs, TimeUnit.MILLISECONDS)
            bump { rpc += 1 }
            if (result is JsonValue.ObjectValue && result.fields.isNotEmpty()) {
                throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM turn/interrupt result must be empty")
            }
            lock.withLock { assertGeneration(currentGeneration) }
        } catch (error: Throwable) {
            lock.withLock {
                if (generation.get() == currentGeneration) {
                    turns.restoreRunningIfInterrupting()
                    notice = SessionNotice(SafeNotice.from(error, "CodeM stop failed"), true)
                }
            }
            throw error
        }
    }

    fun replyToInteraction(requestId: String, choiceIds: List<String>, text: String, cancelled: Boolean) {
        try {
            val stopTurn = lock.withLock {
                interactions.reply(requestId, generation.get(), threadId, choiceIds, text, cancelled).also { snapshotVersion += 1 }
            }
            if (stopTurn) stop()
        } catch (error: Throwable) {
            lock.withLock { interactions.renewPanel(); snapshotVersion += 1 }
            throw error
        } finally { emitSnapshot() }
    }

    /** Only turn/completed permits releasing a running thread; an interrupt receipt is not terminal. */
    fun newChat() = changeThread(allowRunning = true) { coreProcess, currentGeneration ->
        interruptTurn(requireActive = false)
        lock.withLock {
            var remaining = TimeUnit.MILLISECONDS.toNanos(timeouts.rpcMs)
            while (!idleTurnLocked()) {
                assertGeneration(currentGeneration)
                requireReadyLocked()
                if (remaining <= 0) throw CodemError.Conflict("CodeM is still stopping; try again after the turn finishes")
                remaining = turnChanged.awaitNanos(remaining)
            }
            assertGeneration(currentGeneration)
        }
        unsubscribeCurrent(coreProcess, currentGeneration)
        lock.withLock {
            assertGeneration(currentGeneration)
            turns.resetActive()
            historyMessages.clear()
            historyCursor = null
            hasOlder = false
            clearDiffsLocked()
            background = emptyList()
            catalogKind = null
            catalogRows = emptyList()
            notice = null
        }
    }

    fun resumeThread(requestedId: String): String {
        WorkspaceTrustPolicy.requireTrusted(trusted, WorkspaceTrustPolicy.CONTROL_THREAD)
        val id = requestedId.trim()
        if (id.isEmpty()) throw CodemError.Validation("CodeM thread/resume threadId is required")
        return changeThread(allowRunning = false) { coreProcess, currentGeneration ->
            unsubscribeCurrent(coreProcess, currentGeneration)
            val (method, params) = ThreadCommands.resume(id, workingDirectory.toString(), settings.model, settings.intelligence, threadDirectories())
            val result = requestResult(coreProcess, method, params, currentGeneration)
            val actual = result.required("thread").asObject().required("id").asText()
            if (actual != id) throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM resumed $actual, expected $id")
            lock.withLock {
                assertGeneration(currentGeneration)
                turns.resetActive()
                historyMessages.clear()
                clearDiffsLocked()
                bindThreadLocked(actual)
                if (lastThreadId == actual) lastThreadId = null
                historyCursor = null
                historyList = historyList.copy(open = false)
                notice = null
            }
            if (historySource != null) {
                try {
                    loadOlderMessages()
                } catch (error: Throwable) {
                    lock.withLock { notice = SessionNotice(SafeNotice.from(error, "CodeM history could not be restored"), true) }
                }
            }
            actual
        }
    }

    /** Single current subscription per connection. Failure never pretends the old thread was released. */
    private fun unsubscribeCurrent(coreProcess: CoreProcess, currentGeneration: Long) {
        val id = lock.withLock { assertGeneration(currentGeneration); threadId } ?: return
        val result = requestResult(coreProcess, "thread/unsubscribe", JsonValue.obj("threadId" to JsonValue.Text(id)), currentGeneration)
        val status = (result.fields["status"] as? JsonValue.Text)?.value
        if (result.fields.size != 1 || status !in setOf("unsubscribed", "notSubscribed")) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "Invalid CodeM thread/unsubscribe status")
        }
        lock.withLock {
            assertGeneration(currentGeneration)
            lastThreadId = id
            threadId = null
            modesValid = false
        }
    }

    private fun <T> changeThread(allowRunning: Boolean, operation: (CoreProcess, Long) -> T): T {
        WorkspaceTrustPolicy.requireTrusted(trusted, WorkspaceTrustPolicy.CONTROL_THREAD)
        val (coreProcess, currentGeneration) = lock.withLock {
            requireReadyLocked()
            if (threadChangeGeneration != null || turns.current?.phase == TurnPhase.Submitting || (!allowRunning && !idleTurnLocked())) {
                throw CodemError.Conflict("CodeM cannot switch conversations during another operation")
            }
            val current = generation.get()
            threadChangeGeneration = current
            snapshotVersion += 1
            core!! to current
        }
        emitSnapshot()
        try {
            return operation(coreProcess, currentGeneration)
        } finally {
            lock.withLock {
                if (threadChangeGeneration == currentGeneration) threadChangeGeneration = null
                snapshotVersion += 1
            }
            emitSnapshot()
        }
    }

    /** 打开历史只列当前工作区的会话标题，不把 cwd 画进界面。 */
    fun showHistory() {
        if (lock.withLock { phase != ConnectionPhase.Ready }) {
            lock.withLock { historyList = historyList.copy(open = true, loading = false, error = "请先连接 CodeM") }
            return
        }
        lock.withLock { historyList = historyList.copy(open = true, loading = true, error = null) }
        val page = listThreads(null)
        val entries = historyEntries(page)
        lock.withLock {
            threadListCursor = page.nextCursor
            historyList = com.codem.intellij.webview.HistoryListView(
                open = true,
                loading = false,
                entries = entries,
                hasMore = page.nextCursor != null,
                error = null,
            )
        }
    }

    fun moreThreads() {
        val cursor = lock.withLock { if (historyList.open) threadListCursor else null } ?: return
        lock.withLock { historyList = historyList.copy(loading = true, error = null) }
        try {
            val page = listThreads(cursor)
            val entries = historyEntries(page)
            lock.withLock {
                threadListCursor = page.nextCursor
                historyList = historyList.copy(
                    loading = false,
                    entries = historyList.entries + entries,
                    hasMore = page.nextCursor != null,
                    error = null,
                )
            }
        } catch (error: Throwable) {
            lock.withLock {
                historyList = historyList.copy(loading = false, error = SafeNotice.from(error, "无法加载更多会话"))
            }
        }
    }

    private fun historyEntries(page: ThreadListPage): List<com.codem.intellij.webview.HistoryEntryView> {
        return page.threads.map { thread ->
            val id = thread.required("id").asText()
            val preview = (thread.fields["preview"] as? JsonValue.Text)?.value?.trim()?.take(160)
            com.codem.intellij.webview.HistoryEntryView(
                id = id,
                title = preview?.ifBlank { null } ?: "未命名会话",
                archived = (thread.fields["archived"] as? JsonValue.Bool)?.value == true,
            )
        }
    }

    fun closeHistory() {
        lock.withLock { historyList = historyList.copy(open = false, loading = false) }
    }

    fun refreshHistory() = showHistory()

    fun publishFileSearch(search: com.codem.intellij.webview.FileSearchView?) {
        lock.withLock {
            fileSearch = search
            snapshotVersion += 1
        }
    }

    fun rememberSendKey(next: String) {
        if (next != "enter" && next != "modEnter") throw CodemError.Validation("Invalid CodeM send key")
        lock.withLock {
            sendKey = next
            snapshotVersion += 1
        }
    }

    private fun modelChoicesLocked(): List<ComposerChoiceView> {
        val rows = listedModels.ifEmpty { listOf(ListedModel("model-active", settings.model, false)) }
        return rows.map { model ->
            ComposerChoiceView(
                model.handle,
                if (model.modelId.endsWith("/auto")) "Auto" else model.modelId,
                if (model.supportsVision) "支持图片" else "",
                model.modelId == settings.model,
            )
        }
    }

    private fun selectionViewsLocked(): List<SelectionView> {
        val pinned = selections.map { SelectionView(it.id, it.label, it.startLine, it.endLine, pinned = true) }
        val live = liveSelection?.let { SelectionView(it.id, it.label, it.startLine, it.endLine, pinned = false) }
        return if (live == null) pinned else pinned + live
    }

    /** Candidate catalogs belong to the candidate Core and are committed with it. */
    private fun readModels(candidate: CoreProcess): Pair<List<ListedModel>, String> {
        val (method, params) = ThreadCommands.modelList(workingDirectory.toString())
        val result = candidate.request(method, params).get(timeouts.rpcMs, TimeUnit.MILLISECONDS).asObject()
        bump { rpc += 1 }
        val listed = result.required("models").asArray().items.mapIndexed { index, item ->
            val model = item.asObject()
            val id = model.required("id").asText()
            if (id.isBlank()) throw CodemError.Protocol(CodemError.Class.InvalidFrame, "model/list contains an empty id")
            ListedModel("model-${index + 1}", id, (model.fields["supportsVision"] as? JsonValue.Bool)?.value == true)
        }
        val active = result.required("activeModel").asText()
        if (listed.none { it.modelId == active }) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "model/list activeModel is absent from models")
        }
        return listed to active
    }

    fun listThreads(cursor: String? = null): ThreadListPage {
        val (coreProcess, currentGeneration) = readyCore()
        val (method, params) = ThreadCommands.listThreads(workingDirectory.toString(), cursor)
        val result = requestResult(coreProcess, method, params, currentGeneration)
        val threads = result.required("threads").asArray().items.map { it.asObject() }
        val next = when (val value = result.fields["nextCursor"]) {
            null, JsonValue.Null -> null
            is JsonValue.Text -> value.value
            else -> throw CodemError.Protocol(CodemError.Class.InvalidFrame, "thread/list nextCursor is invalid")
        }
        val total = (result.required("total") as? JsonValue.NumberValue)?.value?.toInt()
            ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "thread/list total is invalid")
        if (total < 0) throw CodemError.Protocol(CodemError.Class.InvalidFrame, "thread/list total is invalid")
        return ThreadListPage(threads, next, total)
    }

    fun clearThread(operationId: String): String {
        WorkspaceTrustPolicy.requireTrusted(trusted, WorkspaceTrustPolicy.CONTROL_THREAD)
        requireIdleTurn("thread/clear")
        val (coreProcess, currentThread, currentGeneration) = readyThread()
        val (method, params) = ThreadCommands.clear(
            currentThread,
            operationId,
            workingDirectory.toString(),
            settings.model,
            settings.intelligence,
            settings.workMode,
            threadDirectories(),
        )
        val result = requestResult(coreProcess, method, params, currentGeneration)
        if ((result.fields["operationId"] as? JsonValue.Text)?.value != operationId ||
            (result.fields["previousThreadId"] as? JsonValue.Text)?.value != currentThread
        ) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM clear changed operation or source identity")
        }
        val target = result.required("thread").asObject()
        val targetId = target.required("id").asText()
        if (targetId == currentThread || (target.fields["status"] as? JsonValue.Text)?.value != "loaded") {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "Invalid CodeM clear target")
        }
        lock.withLock {
            assertGeneration(currentGeneration)
            threadId = targetId
            turns.resetActive()
        }
        return targetId
    }

    fun compactThread(): String = startControlTurn("thread/compact/start")

    fun rewindThread(): String = startControlTurn("thread/rewind/start")

    fun steerTurn(text: String, submissionId: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) throw CodemError.Validation("CodeM turn/steer text must be non-empty")
        val (coreProcess, currentThread, turnId, currentGeneration) = lock.withLock {
            requireReadyLocked()
            val turn = turns.current ?: throw CodemError.Conflict("CodeM turn/steer has no active turn")
            if (turn.phase != TurnPhase.Running || turn.turnId == "pending") {
                throw CodemError.Conflict("CodeM turn/steer requires a running turn")
            }
            Quadruple(core!!, threadId ?: throw CodemError.Conflict("no thread"), turn.turnId, generation.get())
        }
        val (method, params) = ThreadCommands.steer(currentThread, turnId, submissionId, trimmed)
        val result = requestResult(coreProcess, method, params, currentGeneration)
        if ((result.fields["turnId"] as? JsonValue.Text)?.value != turnId) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM turn/steer changed turn identity")
        }
        if ((result.fields["submissionId"] as? JsonValue.Text)?.value != submissionId) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM turn/steer changed submission identity")
        }
    }

    fun renameThread(name: String) {
        requireIdleTurn("thread/name/set")
        val (coreProcess, currentThread, currentGeneration) = readyThread()
        val (method, params) = ThreadCommands.rename(currentThread, name, workingDirectory.toString())
        requestResult(coreProcess, method, params, currentGeneration)
    }

    fun archiveThread(archived: Boolean) {
        requireIdleTurn(if (archived) "thread/archive" else "thread/unarchive")
        val (coreProcess, currentThread, currentGeneration) = readyThread()
        val (method, params) = ThreadCommands.archive(currentThread, archived, workingDirectory.toString())
        requestResult(coreProcess, method, params, currentGeneration)
        if (archived) {
            lock.withLock {
                assertGeneration(currentGeneration)
                threadId = null
            }
        }
    }

    fun deleteThread() {
        requireIdleTurn("thread/delete")
        val (coreProcess, currentThread, currentGeneration) = readyThread()
        val (method, params) = ThreadCommands.delete(currentThread, workingDirectory.toString())
        requestResult(coreProcess, method, params, currentGeneration)
        lock.withLock {
            assertGeneration(currentGeneration)
            threadId = null
        }
    }

    fun forkThread(): String {
        requireIdleTurn("thread/fork")
        val (coreProcess, currentThread, currentGeneration) = readyThread()
        val (method, params) = ThreadCommands.fork(currentThread, workingDirectory.toString())
        val result = requestResult(coreProcess, method, params, currentGeneration)
        return ((result.fields["thread"] as? JsonValue.ObjectValue)?.fields?.get("id") as? JsonValue.Text)?.value
            ?: (result.fields["threadId"] as? JsonValue.Text)?.value
            ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "thread/fork omitted thread id")
    }

    fun runShellCommand(command: String) {
        val trimmed = command.trim()
        if (trimmed.isEmpty()) throw CodemError.Validation("CodeM thread/shellCommand command must be non-empty")
        val (coreProcess, currentThread, currentGeneration) = readyThread()
        val (method, params) = ThreadCommands.shellCommand(currentThread, trimmed)
        val result = requestResult(coreProcess, method, params, currentGeneration)
        if (result.fields.isNotEmpty()) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "Invalid CodeM thread/shellCommand result")
        }
    }

    fun startSideQuestion(question: String): String {
        val trimmed = question.trim()
        if (trimmed.isEmpty()) throw CodemError.Validation("CodeM side question must be non-empty")
        requireIdleTurn("thread/sideQuestion/start")
        val (coreProcess, currentThread, currentGeneration) = readyThread()
        val (method, params) = ThreadCommands.sideQuestion(currentThread, trimmed)
        val result = requestResult(coreProcess, method, params, currentGeneration)
        val accepted = result.required("sideQuestion").asObject()
        if ((accepted.fields["status"] as? JsonValue.Text)?.value != "accepted") {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM side question returned invalid status")
        }
        return accepted.required("id").asText()
    }

    fun cancelSideQuestion(sideQuestionId: String) {
        val (coreProcess, currentThread, currentGeneration) = readyThread()
        val (method, params) = ThreadCommands.cancelSideQuestion(currentThread, sideQuestionId)
        val result = requestResult(coreProcess, method, params, currentGeneration)
        if ((result.fields["sideQuestionId"] as? JsonValue.Text)?.value != sideQuestionId ||
            (result.fields["status"] as? JsonValue.Text)?.value != "cancelled"
        ) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM side question cancellation returned an invalid status")
        }
    }

    fun cancelBackgroundTask(taskId: String): String {
        val (coreProcess, currentThread, currentGeneration) = readyThread()
        val (method, params) = ThreadCommands.cancelBackgroundTask(currentThread, taskId)
        val result = requestResult(coreProcess, method, params, currentGeneration)
        val status = (result.fields["status"] as? JsonValue.Text)?.value
        if (status != "cancelled" && status != "notFound" && status != "noop") {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM background cancellation returned invalid status")
        }
        return status
    }

    fun listLiveTurns(cursor: Int? = null): JsonValue.ObjectValue {
        val (coreProcess, currentThread, currentGeneration) = readyThread()
        val (method, params) = ThreadCommands.liveTurns(currentThread, cursor)
        val result = requestResult(coreProcess, method, params, currentGeneration)
        lock.withLock {
            catalogKind = "live"
            catalogRows = listOf(CatalogRowView("live turns", "diagnostic snapshot, not JSONL history"))
        }
        return result
    }

    /** A03：读当前线程 modes。无线程时只返回本地设置。 */
    fun readModes(): ModeState {
        val currentThread = lock.withLock { threadId } ?: return lock.withLock { modes.copy(permissionMode = settings.permissionMode, workMode = uiToCoreWork(settings.workMode)) }
        val (coreProcess, currentGeneration) = readyCore()
        val (method, params) = ThreadCommands.readModes(currentThread)
        val result = requestResult(coreProcess, method, params, currentGeneration)
        return acceptModes(result, currentThread, currentGeneration)
    }

    fun setModes(expectedRevision: Int, permissionMode: String? = null, workMode: String? = null): ModeState {
        val currentThread = lock.withLock { threadId } ?: throw CodemError.Conflict("no thread")
        val coreWork = workMode?.let { uiToCoreWork(it) }
        val (coreProcess, currentGeneration) = readyCore()
        val (method, params) = ThreadCommands.setModes(currentThread, expectedRevision, permissionMode, coreWork)
        return try {
            val result = requestResult(coreProcess, method, params, currentGeneration)
            acceptModes(result, currentThread, currentGeneration)
        } catch (error: Throwable) {
            lock.withLock {
                notice = SessionNotice(SafeNotice.from(error, "CodeM mode change failed"), true)
            }
            throw error
        }
    }

    fun setEffort(effort: String) {
        lock.withLock { settings = settings.copy(intelligence = effort) }
        resumeIfThread("setEffort")
    }

    /**
     * 菜单 id 是不透明句柄。Core 只接受 model/list 里的真实模型 id，
     * 不能把句柄或文件路径发回去。
     */
    fun chooseModel(id: String) {
        val modelId = lock.withLock {
            listedModels.find { it.handle == id }?.modelId
                ?: if (listedModels.isEmpty() && id == "model-active") settings.model
                else throw CodemError.Validation("CodeM model is not in the current catalog")
        }
        lock.withLock { settings = settings.copy(model = modelId) }
        resumeIfThread("chooseModel")
    }

    fun setWorkMode(workMode: String) {
        val current = lock.withLock { threadId to modes.revision }
        if (current.first == null) {
            lock.withLock { settings = settings.copy(workMode = workMode) }
            return
        }
        setModes(current.second, workMode = workMode)
        lock.withLock { settings = settings.copy(workMode = workMode) }
    }

    fun setPermission(permission: String) {
        val current = lock.withLock { threadId to modes.revision }
        if (current.first == null) {
            lock.withLock { settings = settings.copy(permissionMode = permission) }
            return
        }
        setModes(current.second, permissionMode = permission)
        lock.withLock { settings = settings.copy(permissionMode = permission) }
    }

    fun setTheme(next: String) {
        lock.withLock { theme = next }
    }

    /** A08：条件入口由 snapshot.canLoadOlder 控制。 */
    fun loadOlderMessages() {
        val (currentThread, cursor) = lock.withLock { threadId to historyCursor }
        val id = currentThread ?: throw CodemError.Conflict("no thread")
        val source = historySource ?: throw CodemError.Conflict("CodeM history source is not configured")
        val page = source.read(workingDirectory.toString(), id, cursor)
        lock.withLock {
            historyCursor = page.nextCursor
            hasOlder = page.nextCursor != null
            historyMessages += page.turns.flatMap { turn ->
                val turnId = turn.submissionId
                turn.userTexts.mapIndexed { index, text -> ChatMessageView("hist-user-${turn.submissionId}-$index", "user", text, turnId = turnId) } +
                    turn.tools.mapIndexed { index, (id, content) ->
                        ChatMessageView(
                            "hist-tool-${turn.submissionId}-$index",
                            "tool",
                            content ?: "",
                            turnId = turnId,
                            label = id,
                            status = if (content == null) "incomplete" else "completed",
                        )
                    } +
                    turn.assistantTexts.mapIndexed { index, text -> ChatMessageView("hist-asst-${turn.submissionId}-$index", "assistant", text, turnId = turnId) }
            }
        }
    }

    /** 当前划选只展示，不进发送列表，直到用户钉住。切换选区会换掉这一条。 */
    fun setLiveSelection(path: String?, startLine: Int, endLine: Int, text: String) {
        lock.withLock {
            if (path == null || text.isEmpty()) {
                liveSelection = null
                return@withLock
            }
            val file = path.substringAfterLast('/').substringAfterLast('\\')
            val label = "$file:$startLine-$endLine"
            if (dismissedLiveLabel == label) return@withLock
            dismissedLiveLabel = null
            liveSelection = SelectionHandle("sel-current", label, text, startLine, endLine, pinned = false)
            snapshotVersion += 1
        }
    }

    /** A09：把当前划选钉成不透明句柄。标签只有文件名和行号。 */
    fun pinSelection(): String? {
        val snap = selectionReader?.current()
        return lock.withLock {
            val source = snap?.let {
                val file = it.path.substringAfterLast('/').substringAfterLast('\\')
                SelectionHandle("sel-current", "$file:${it.startLine}-${it.endLine}", it.text, it.startLine, it.endLine, pinned = false)
            } ?: liveSelection
            if (source == null || source.text.isEmpty()) return@withLock null
            if (selections.any { it.text == source.text && it.label == source.label }) return@withLock selections.first { it.text == source.text }.id
            val id = "sel-${selections.size + 1}"
            selections += source.copy(id = id, pinned = true)
            snapshotVersion += 1
            id
        }
    }

    fun removeSelection(id: String) {
        lock.withLock {
            if (id == "sel-current") {
                dismissedLiveLabel = liveSelection?.label
                liveSelection = null
            } else {
                selections.removeAll { it.id == id }
            }
            snapshotVersion += 1
        }
    }

    fun attachPastedImages(images: List<ImageAttachment>): List<String> = lock.withLock {
        WorkspaceTrustPolicy.requireTrusted(trusted, WorkspaceTrustPolicy.MUTATE_FILES)
        requireReadyLocked()
        attachments.addImages(images).also { snapshotVersion += 1 }
    }

    fun attach(path: Path, kind: AttachmentStore.Kind): String = lock.withLock {
        WorkspaceTrustPolicy.requireTrusted(trusted, WorkspaceTrustPolicy.MUTATE_FILES)
        attachments.add(path, kind).also { snapshotVersion += 1 }
    }

    fun removeAttachment(id: String) {
        lock.withLock { attachments.remove(id); snapshotVersion += 1 }
    }

    /** A10：只有 Core 给出 hunks 才打开原生 Diff；没有差异内容时明确拒绝，不展示文件名充数。 */
    fun openDiff(id: String) {
        val (preview, content) = lock.withLock {
            val row = diffs.find { it.id == id } ?: throw CodemError.Validation("CodeM diff $id is not available")
            val path = id.removePrefix("diff-").toIntOrNull()?.let { diffPaths.getOrNull(it - 1) }
            row to path?.let { diffContents[it] }
        }
        val texts = content?.texts()
            ?: throw CodemError.Validation("CodeM diff ${preview.label} has no file difference to show yet")
        diffPresenter.open(
            com.codem.intellij.ide.DiffPreview(
                preview.id,
                preview.label,
                content.path,
                preview.added,
                preview.removed,
                when (preview.preview) {
                    "complete" -> com.codem.intellij.ide.DiffPreview.Kind.Complete
                    "partial" -> com.codem.intellij.ide.DiffPreview.Kind.Partial
                    "binary" -> com.codem.intellij.ide.DiffPreview.Kind.Binary
                    else -> com.codem.intellij.ide.DiffPreview.Kind.Missing
                },
            ),
            com.codem.intellij.ide.DiffTexts(texts.first, texts.second),
        )
    }

    fun selectSkill(id: String?) {
        lock.withLock {
            if (id != null && skills.none { it.id == id }) throw CodemError.Validation("CodeM skill is not in the current catalog")
            selectedSkill = id
        }
    }

    fun addDirectory(path: Path) {
        val real = PathGuard.realPathOrNormalized(path)
        if (!Files.isDirectory(real)) throw CodemError.Validation("CodeM extra directory must be a directory")
        val id = "dir-${directories.size + 1}"
        lock.withLock {
            directories += DirectoryRef(id, real.fileName.toString(), real)
        }
        val current = lock.withLock { threadId }
        if (current != null) resumeThread(current)
    }

    fun removeDirectory(id: String) {
        lock.withLock { directories.removeAll { it.id == id } }
        val current = lock.withLock { threadId }
        if (current != null) resumeThread(current)
    }

    fun listBackgroundTerminals(): List<BackgroundView> {
        val (coreProcess, currentThread, currentGeneration) = readyThread()
        val (method, params) = ThreadCommands.backgroundTerminals(currentThread)
        val result = requestResult(coreProcess, method, params, currentGeneration)
        val listed = (result.fields["terminals"] as? JsonValue.ArrayValue)?.items.orEmpty().mapIndexed { index, item ->
            val terminal = item.asObject()
            val pid = ((terminal.fields["processId"] as? JsonValue.NumberValue)?.literal ?: "${index + 1}")
            BackgroundView(pid, "terminal $pid", (terminal.fields["inProgress"] as? JsonValue.Bool)?.value == true)
        }
        lock.withLock { background = listed }
        return listed
    }

    fun terminateBackground(processId: String) {
        val pid = processId.toIntOrNull() ?: throw CodemError.Validation("CodeM background processId is invalid")
        val (coreProcess, currentThread, currentGeneration) = readyThread()
        val listed = listBackgroundTerminals()
        if (listed.none { it.id == processId }) throw CodemError.Validation("CodeM background terminal $pid is not on the current thread")
        val (method, params) = ThreadCommands.terminateBackground(currentThread, pid)
        requestResult(coreProcess, method, params, currentGeneration)
        listBackgroundTerminals()
    }

    fun cleanBackground() {
        val (coreProcess, currentThread, currentGeneration) = readyThread()
        val (method, params) = ThreadCommands.cleanBackground(currentThread)
        requestResult(coreProcess, method, params, currentGeneration)
        lock.withLock { background = emptyList() }
    }

    fun loadCatalog(kind: String): List<CatalogRowView> {
        val (coreProcess, currentGeneration) = readyCore()
        val cwd = workingDirectory.toString()
        val currentThread = lock.withLock { threadId }
        val (method, params) = when (kind) {
            "skills" -> ThreadCommands.skills(cwd, currentThread)
            "environment" -> ThreadCommands.environmentInfo(cwd)
            "config" -> ThreadCommands.configRead(cwd)
            "hooks" -> ThreadCommands.hooksList(cwd)
            "plugins" -> ThreadCommands.pluginList(cwd)
            "permissions" -> ThreadCommands.permissionProfiles(cwd)
            "spaces" -> ThreadCommands.spaceList(cwd)
            "provider" -> ThreadCommands.modelProvider(cwd)
            "tools" -> ThreadCommands.toolsList(currentThread ?: throw CodemError.Conflict("no thread"))
            "live" -> ThreadCommands.liveTurns(currentThread ?: throw CodemError.Conflict("no thread"), null)
            else -> throw CodemError.Validation("Unsupported CodeM catalog $kind")
        }
        val result = requestResult(coreProcess, method, params, currentGeneration)
        val rows = desensitizeCatalog(kind, result)
        lock.withLock {
            catalogKind = kind
            catalogRows = rows
            if (kind == "skills") {
                skills = rows.map { SkillView(it.label, it.label, it.detail) }
            }
        }
        return rows
    }

    fun applyViewAction(action: ViewAction) {
        when (action) {
            ViewAction.Ready -> Unit
            ViewAction.Connect -> connect()
            ViewAction.SignIn, ViewAction.RefreshAccount -> {
                val authClient = authOverride ?: AuthClient(runtime, workingDirectory, timeouts = timeouts)
                authClient.status()
            }
            ViewAction.SignOut, ViewAction.CancelSignIn -> Unit
            ViewAction.NewChat -> newChat()
            ViewAction.Stop -> stop()
            ViewAction.RefreshSpaces -> Unit
            ViewAction.OlderMessages -> loadOlderMessages()
            ViewAction.RefreshBackground -> listBackgroundTerminals()
            ViewAction.CleanBackground -> cleanBackground()
            ViewAction.AddDirectory -> {
                val path = directoryPicker?.pick() ?: throw CodemError.Validation("CodeM extra directory requires a host picker")
                addDirectory(path)
            }
            ViewAction.CancelSideQuestion -> {
                val id = lock.withLock { sideQuestionId } ?: throw CodemError.Conflict("no side question")
                cancelSideQuestion(id)
            }
            ViewAction.PinSelection -> pinSelection()
            is ViewAction.RemoveSelection -> removeSelection(action.id)
            ViewAction.ShowHistory, ViewAction.RefreshHistory -> showHistory()
            ViewAction.MoreThreads -> moreThreads()
            ViewAction.CloseHistory -> closeHistory()
            is ViewAction.SetSendKey -> rememberSendKey(action.sendKey)
            is ViewAction.SearchFiles, is ViewAction.SelectFile, is ViewAction.PasteImages -> Unit
            is ViewAction.Send -> send(action.text, action.requestId, action.skillName, action.attachmentIds, action.selectionIds)
            is ViewAction.PanelReply -> replyToInteraction(action.id, action.choiceIds, action.text, action.cancelled)
            is ViewAction.ResumeThread -> resumeThread(action.threadId)
            is ViewAction.SetEffort -> setEffort(action.effort)
            is ViewAction.SetWorkMode -> setWorkMode(action.workMode)
            is ViewAction.SetPermission -> setPermission(action.permission)
            is ViewAction.SetTheme -> setTheme(action.theme)
            is ViewAction.PickAttachment -> Unit
            is ViewAction.ChooseModel -> chooseModel(action.id)
            is ViewAction.ChooseSpace -> chooseSpace(action.id)
            is ViewAction.OpenDiff -> openDiff(action.id)
            is ViewAction.TerminateBackground -> terminateBackground(action.id)
            is ViewAction.CancelBackgroundTask -> cancelBackgroundTask(action.id)
            is ViewAction.RemoveAttachment -> removeAttachment(action.id)
            is ViewAction.RemoveDirectory -> removeDirectory(action.id)
            is ViewAction.SelectSkill -> selectSkill(action.id)
            is ViewAction.LoadCatalog -> loadCatalog(action.kind)
            is ViewAction.ManageThread -> when (action.operation) {
                "rename" -> renameThread(action.name)
                "fork" -> forkThread()
                "archive" -> archiveThread(true)
                "unarchive" -> archiveThread(false)
                "delete" -> deleteThread()
            }
            is ViewAction.Steer -> submit(action.requestId) { steerTurn(action.text, action.requestId) }
            is ViewAction.AskSideQuestion -> submit(action.requestId) {
                sideQuestionId = startSideQuestion(action.text)
            }
            is ViewAction.ShellCommand -> submit(action.requestId) { runShellCommand(action.text) }
            is ViewAction.CompactThread -> compactThread()
            is ViewAction.RewindThread -> rewindThread()
            is ViewAction.ClearThread -> clearThread(action.requestId)
        }
    }

    fun close(): CompletableFuture<Void> {
        val (current, pending) = lock.withLock {
            phase = ConnectionPhase.Closing
            generation.set(connectionIds.incrementAndGet())
            interactions.revoke(generation.get())
            turnChanged.signalAll()
            retireCoresLocked() to pendingConnection
        }
        val futures = current.map { it.close() } + listOfNotNull(pending)
        return CompletableFuture.allOf(*futures.toTypedArray()).whenComplete { _, _ ->
            lock.withLock { attachments.close(); phase = ConnectionPhase.Disconnected }
        }
    }

    private fun replaceConnection(preflightGeneration: Long, catalog: SpaceList, prepared: PreparedSpace, broker: SpaceGateway, status: AuthStatus) {
        val currentGeneration = connectionIds.incrementAndGet()
        var startupError: CodemError? = null
        lock.withLock {
            assertGeneration(preflightGeneration)
            phase = ConnectionPhase.Starting
        }
        emitSnapshot()
        val launch = broker.launchArguments(prepared)
        val created = CoreProcess(
            runtime = runtime,
            workingDirectory = workingDirectory,
            clientInfo = ClientInfo("codem-intellij", "0.1.0"),
            extraArguments = launch.first,
            extraEnvironment = coreEnvironment(launch.second),
            timeouts = timeouts,
            onNotification = { notification ->
                if (!KnownNotifications.isKnown(notification.method)) {
                    throw CodemError.Protocol(CodemError.Class.UnknownNotification, "CodeM App Server emitted unknown notification ${notification.method}")
                }
                val changed = lock.withLock {
                    if (generation.get() != currentGeneration) return@withLock false
                    applyNotificationLocked(notification)
                    turnChanged.signalAll()
                    snapshotVersion += 1
                    true
                }
                if (changed) emitSnapshot()
            },
            onRequest = { request: RpcRequest, peer: RpcPeer ->
                // 入队本身不是界面事实：受理后必须升版本并推快照，否则审批卡片永远不出现。
                val accepted = lock.withLock {
                    if (generation.get() != currentGeneration) {
                        peer.respondError(request.id, -32000, "CodeM interaction belongs to a retired connection")
                        return@withLock false
                    }
                    val queued = interactions.handle(request, peer, currentGeneration, threadId)
                    if (queued) snapshotVersion += 1
                    queued
                }
                if (accepted) emitSnapshot()
            },
            onProtocolError = { error ->
                lock.withLock {
                    startupError = error
                    if (generation.get() == currentGeneration) {
                        phase = ConnectionPhase.Failed
                        notice = SessionNotice(SafeNotice.from(error, "CodeM connection failed"), true)
                    }
                }
            },
            onExit = { lock.withLock { attachments.release(currentGeneration) } },
            processFactory = processFactory ?: ::defaultProcess,
        ).start()
        bump { core += 1 }
        try {
            val (models, activeModel) = readModels(created)
            val outgoing = lock.withLock {
                assertGeneration(preflightGeneration)
                startupError?.let { throw it }
                val old = retireCoresLocked()
                generation.set(currentGeneration)
                interactions.revoke(currentGeneration)
                resetConnectionStateLocked()
                core = created
                auth = status
                spaces = catalog.copy(current = prepared.projectKey)
                space = prepared
                listedModels = models
                settings = settings.copy(model = activeModel)
                phase = ConnectionPhase.Ready
                notice = null
                snapshotVersion += 1
                old
            }
            emitSnapshot()
            closeQuietly(outgoing)
        } catch (error: Throwable) {
            created.close().join()
            throw error
        }
    }

    /** Connection handles never survive a replacement; local preferences and draft text do. */
    private fun resetConnectionStateLocked() {
        threadChangeGeneration = null
        turnChanged.signalAll()
        threadId = null
        lastThreadId = null
        submission = null
        modes = ModeState()
        modesValid = false
        turns.resetActive()
        historyMessages.clear()
        historyCursor = null
        hasOlder = false
        historyList = com.codem.intellij.webview.HistoryListView()
        threadListCursor = null
        turnTimings.clear()
        threadStatus = null
        selectedSkill = null
        skills = emptyList()
        catalogKind = null
        catalogRows = emptyList()
        directories.clear()
        attachments.clear()
        draft.attachments = emptyList()
        selections.clear()
        liveSelection = null
        dismissedLiveLabel = null
        fileSearch = null
        clearDiffsLocked()
        background = emptyList()
        sideQuestionId = null
    }

    private fun threadDirectories(): List<String> = lock.withLock {
        directories.map { it.path.toString() } + attachments.rootForCore().toString()
    }

    private fun startThread(coreProcess: CoreProcess): String {
        val extra = threadDirectories().map { JsonValue.Text(it) }
        val result = coreProcess.request(
            "thread/start",
            JsonValue.obj(
                "cwd" to JsonValue.Text(workingDirectory.toString()),
                "model" to JsonValue.Text(settings.model),
                "extensions" to JsonValue.obj(
                    "codem" to JsonValue.obj("intelligence" to JsonValue.Text(settings.intelligence)),
                ),
                "additionalDirectories" to JsonValue.ArrayValue(extra),
                "mcpServers" to JsonValue.ArrayValue(emptyList()),
                "permissionMode" to JsonValue.Text(settings.permissionMode),
                "executionMode" to JsonValue.Text(settings.workMode),
            ),
        ).get(timeouts.rpcMs, TimeUnit.MILLISECONDS).asObject()
        bump { rpc += 1 }
        return result.required("thread").asObject().required("id").asText()
    }

    /** Keep the old connection alive until initialize and model/list both succeed. */
    private fun beginPreflight(next: ConnectionPhase): Long {
        val previous = lock.withLock {
            if (pendingConnection != null || phase == ConnectionPhase.Closing) {
                throw CodemError.Conflict("CodeM connection is already in progress")
            }
            if (!idleTurnLocked()) throw CodemError.Conflict("CodeM cannot replace a connection during an active turn")
            pendingConnection = CompletableFuture()
            phase = next
            notice = null
            snapshotVersion += 1
            generation.get()
        }
        emitSnapshot()
        return previous
    }

    private fun finishPreflight() {
        val completed = lock.withLock {
            pendingConnection.also { pendingConnection = null }
        }
        completed?.complete(null)
    }

    /** 连接失败：旧 Core 仍在服务就回到 ready，已经退役才是 failed。 */
    private fun failConnection(activeGeneration: Long, error: Throwable, fallback: String) {
        lock.withLock {
            if (generation.get() != activeGeneration) return@withLock
            phase = if (core != null) ConnectionPhase.Ready else ConnectionPhase.Failed
            notice = SessionNotice(SafeNotice.from(error, fallback), true)
            snapshotVersion += 1
        }
        emitSnapshot()
    }

    private fun retireCoresLocked(): List<CoreProcess> {
        val active = core
        core = null
        val outgoing = buildList {
            if (active != null) add(active)
            addAll(retiring)
        }
        retiring.clear()
        return outgoing
    }

    private fun closeQuietly(processes: List<CoreProcess>) {
        if (processes.isEmpty()) return
        val futures = processes.map { it.close() }
        try {
            CompletableFuture.allOf(*futures.toTypedArray()).get(timeouts.shutdownBudgetMs, TimeUnit.MILLISECONDS)
        } catch (_: Exception) {
        }
    }

    private fun coreEnvironment(spaceEnv: Map<String, String>): Map<String, String> {
        val brokerCommand = encodeJson(
            JsonValue.ArrayValue(
                listOf(JsonValue.Text(runtime.authExecutable.toString()), JsonValue.Text("__host-serve")),
            ),
        )
        return spaceEnv + mapOf(
            "CODEM_ROUTER_CREDENTIAL_HOST_CMD" to brokerCommand,
            "CODEM_HOST_CHANNEL_CMD" to brokerCommand,
            "CODEM_SESSION_SOURCE" to "intellij",
        )
    }

    private fun bump(update: CallBudget.() -> Unit) {
        lock.withLock { budget.update() }
    }

    private fun startControlTurn(methodName: String): String {
        requireIdleTurn(methodName)
        val (coreProcess, currentThread, currentGeneration) = readyThread()
        val (method, params) = if (methodName == "thread/compact/start") {
            ThreadCommands.compact(currentThread)
        } else {
            ThreadCommands.rewind(currentThread)
        }
        val result = requestResult(coreProcess, method, params, currentGeneration)
        val turnId = ((result.fields["turn"] as? JsonValue.ObjectValue)?.fields?.get("id") as? JsonValue.Text)?.value
            ?: (result.fields["turnId"] as? JsonValue.Text)?.value
            ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "$methodName omitted turn id")
        lock.withLock {
            assertGeneration(currentGeneration)
            turns.beginSubmit(methodName)
            turns.acceptStarted(turnId)
        }
        return turnId
    }

    private fun requestResult(
        coreProcess: CoreProcess,
        method: String,
        params: JsonValue.ObjectValue,
        currentGeneration: Long,
    ): JsonValue.ObjectValue {
        val result = coreProcess.request(method, params).get(timeouts.rpcMs, TimeUnit.MILLISECONDS).asObject()
        bump { rpc += 1 }
        lock.withLock { assertGeneration(currentGeneration) }
        return result
    }

    private fun readyCore(): Pair<CoreProcess, Long> = lock.withLock {
        requireReadyLocked()
        core!! to generation.get()
    }

    private fun readyThread(): Triple<CoreProcess, String, Long> = lock.withLock {
        requireReadyLocked()
        Triple(core!!, threadId ?: throw CodemError.Conflict("no thread"), generation.get())
    }

    private fun requireReadyLocked() {
        if (phase != ConnectionPhase.Ready || core == null) throw CodemError.Conflict("CodeM is not ready")
    }

    private fun requireIdleTurn(method: String) {
        lock.withLock {
            if (threadChangeGeneration != null) throw CodemError.Conflict("CodeM is switching conversations")
            val turnPhase = turns.current?.phase
            if (turnPhase == TurnPhase.Submitting || turnPhase == TurnPhase.Running || turnPhase == TurnPhase.Interrupting) {
                throw CodemError.Conflict("Cannot $method active CodeM thread")
            }
        }
    }

    private fun assertGeneration(expected: Long) {
        if (generation.get() != expected) throw CodemError.Cancelled("CodeM connection generation changed")
    }

    private fun idleTurnLocked(): Boolean {
        val turnPhase = turns.current?.phase
        return turnPhase != TurnPhase.Submitting && turnPhase != TurnPhase.Running && turnPhase != TurnPhase.Interrupting
    }

    /** A11：计划/用量/活动进入快照，activity 不是终态，用量不是账单。 */
    private fun capabilityViewLocked(): CapabilityView {
        val turn = turns.current
        return CapabilityView(
            plan = planItems(turn?.plan),
            usage = usageView(turn?.usage),
            activity = turn?.activity,
            changes = diffs.toList(),
            threadStatus = threadStatus,
        )
    }

    private fun bindThreadLocked(id: String) {
        threadId = id
        if (historySource != null && historyMessages.isEmpty()) {
            hasOlder = true
            historyCursor = null
        }
    }

    private fun uiToCoreWork(workMode: String): String = when (workMode) {
        "plan" -> "plan"
        "default", "normal" -> "normal"
        else -> throw CodemError.Validation("Invalid CodeM workMode")
    }

    private fun resumeIfThread(reason: String) {
        val id = lock.withLock { threadId } ?: return
        requireIdleTurn(reason)
        resumeThread(id)
    }

    /** A04/A09/B06：skill 走结构化 input；附件与 skill 互斥；选区只追加文本。 */
    private fun turnStartParams(
        activeThread: String,
        requestId: String,
        text: String,
        skillName: String?,
        attachmentIds: List<String>,
        selectionIds: List<String>,
    ): JsonValue.ObjectValue {
        if (skillName != null) {
            return JsonValue.obj(
                "threadId" to JsonValue.Text(activeThread),
                "clientUserMessageId" to JsonValue.Text(requestId),
                "input" to ThreadCommands.skillInput(skillName, text),
            )
        }
        val (resolvedAttachments, resolvedSelections) = lock.withLock {
            val files = attachments.retain(attachmentIds, generation.get())
            val selected = selectionIds.map { id ->
                selections.find { it.id == id } ?: liveSelection?.takeIf { it.id == id }
                    ?: throw CodemError.Validation("CodeM selection $id is not available")
            }
            files to selected
        }
        val images = resolvedAttachments.filter { it.kind == "image" }
        val files = resolvedAttachments.filter { it.kind != "image" }
        val input = buildList {
            add(
                JsonValue.obj(
                    "type" to JsonValue.Text("text"),
                    "text" to JsonValue.Text(text),
                    "textElements" to JsonValue.ArrayValue(emptyList()),
                ),
            )
            resolvedSelections.forEach { selection ->
                add(
                    JsonValue.obj(
                        "type" to JsonValue.Text("text"),
                        "text" to JsonValue.Text(selection.text),
                        "textElements" to JsonValue.ArrayValue(emptyList()),
                    ),
                )
            }
            images.forEach { image ->
                add(JsonValue.obj("type" to JsonValue.Text("localImage"), "path" to JsonValue.Text(image.path.toString())))
            }
        }
        val fields = linkedMapOf(
            "threadId" to JsonValue.Text(activeThread),
            "clientUserMessageId" to JsonValue.Text(requestId),
            "input" to JsonValue.ArrayValue(input),
        )
        if (files.isNotEmpty()) {
            fields["extensions"] = JsonValue.obj(
                "codem" to JsonValue.obj(
                    "attachments" to JsonValue.ArrayValue(
                        files.map { JsonValue.obj("kind" to JsonValue.Text(it.kind), "path" to JsonValue.Text(it.path.toString())) },
                    ),
                ),
            )
        }
        return JsonValue.ObjectValue(fields)
    }

    private fun acceptModes(result: JsonValue.ObjectValue, expectedThread: String, currentGeneration: Long): ModeState = lock.withLock {
        assertGeneration(currentGeneration)
        val reported = (result.fields["threadId"] as? JsonValue.Text)?.value
        if (reported != null && reported != expectedThread) {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM mode response thread mismatch")
        }
        val stateObj = (result.fields["state"] as? JsonValue.ObjectValue) ?: result
        val revision = (stateObj.fields["revision"] as? JsonValue.NumberValue)?.value?.toInt()
            ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "Invalid CodeM mode revision")
        val epoch = (stateObj.fields["permissionEpoch"] as? JsonValue.NumberValue)?.value?.toInt()
            ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "Invalid CodeM permission epoch")
        val permission = (stateObj.fields["permissionMode"] as? JsonValue.Text)?.value
            ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "Invalid CodeM permission mode")
        val work = (stateObj.fields["workMode"] as? JsonValue.Text)?.value
            ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "Invalid CodeM work mode")
        if (work != "normal" && work != "plan") {
            throw CodemError.Protocol(CodemError.Class.InvalidFrame, "Invalid CodeM work mode")
        }
        val next = ModeState(revision, epoch, permission, work)
        if (modesValid) {
            if (next.revision < modes.revision) return modes
            if (next.revision == modes.revision &&
                (next.permissionMode != modes.permissionMode || next.workMode != modes.workMode || next.permissionEpoch != modes.permissionEpoch)
            ) {
                throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM mode revision has conflicting state")
            }
        }
        modes = next
        modesValid = true
        settings = settings.copy(
            permissionMode = permission,
            workMode = if (work == "plan") "plan" else "default",
        )
        next
    }

    /** B14：通知进入快照 notice/运行信息；warning 不得转成功。 */
    private fun applyNotificationLocked(notification: RpcNotification) {
        val eventThread = (notification.params.fields["threadId"] as? JsonValue.Text)?.value
        if (eventThread != null && eventThread != threadId) return
        when (notification.method) {
            "auth/invalidated" -> {
                phase = ConnectionPhase.Failed
                notice = SessionNotice("CodeM authentication is no longer valid", true)
            }
            "warning" -> {
                val raw = (notification.params.fields["message"] as? JsonValue.Text)?.value ?: "CodeM reported a warning"
                notice = SessionNotice(SafeNotice.from(CodemError.Validation(raw), "CodeM reported a warning"), true)
            }
            "hook/completed" -> {
                notice = SessionNotice("CodeM hook finished", false)
            }
            "skills/changed" -> {
                notice = SessionNotice("CodeM skills catalog changed", true)
            }
            "thread/status/changed" -> {
                threadStatus = (notification.params.fields["status"] as? JsonValue.Text)?.value
            }
            "thread/mode/changed" -> {
                val current = threadId ?: return
                acceptModes(notification.params, current, generation.get())
            }
            "thread/closed", "thread/archived", "thread/deleted" -> {
                if (threadChangeGeneration != null) return
                lastThreadId = threadId ?: lastThreadId
                threadId = null
                modesValid = false
            }
            "turn/diff/updated" -> {
                turns.apply(notification, threadId)
                applyDiffSummaryLocked(notification.params)
            }
            "item/fileChange/delta" -> {
                val content = fileDiffs.accept(notification.params) ?: return
                applyFileDiffLocked(content)
            }
            else -> {
                turns.apply(notification, threadId)
                recordTurnTimingLocked(notification.method)
                if (notification.method == "turn/completed") {
                    interactions.revokeThread(generation.get(), threadId)
                    commitAssistantLocked()
                    attachments.release(generation.get())
                }
            }
        }
    }

    /** 终态：先落思考/工具，再落正文。activity 不是终态。 */
    private fun commitAssistantLocked() {
        val turn = turns.current ?: return
        for (message in turns.committedMessages()) {
            if (historyMessages.none { it.id == message.id }) historyMessages += message
        }
        val text = turn.text.toString()
        if (text.isEmpty()) return
        val id = turn.turnId
        if (historyMessages.any { it.id == id && it.role == "assistant" }) return
        historyMessages += ChatMessageView(id, "assistant", text, turnId = id)
    }

    private fun recordTurnTimingLocked(method: String) {
        val turn = turns.current ?: return
        if (turn.turnId == "pending") return
        if (method == "turn/started" && turnTimings.none { it.turnId == turn.turnId }) {
            turnTimings += TurnTimingView(turn.turnId, turn.startedAt, null)
        }
        if (method == "turn/completed") {
            turnTimings = turnTimings.map { timing ->
                if (timing.turnId == turn.turnId && timing.finishedAt == null) timing.copy(finishedAt = turn.finishedAt ?: System.currentTimeMillis()) else timing
            }.toMutableList()
        }
    }

    private fun emitSnapshot() {
        onSnapshot?.invoke(snapshot())
    }

    /**
     * `turn/diff/updated` 只汇总路径与行数，没有 hunks。它负责建行和刷新统计，
     * 能不能打开由是否已收到 `item/fileChange/delta` 决定，不拿汇总冒充差异。
     */
    private fun clearDiffsLocked() {
        diffs.clear()
        diffPaths.clear()
        diffContents.clear()
        fileDiffs = FileDiffAssembler()
    }

    private fun applyDiffSummaryLocked(params: JsonValue.ObjectValue) {
        val files = (params.fields["diff"] as? JsonValue.ArrayValue)?.items
            ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM diff summary is missing files")
        val rows = files.map { item ->
            val file = item.asObject()
            val path = (file.fields["path"] as? JsonValue.Text)?.value?.takeIf { it.isNotBlank() }
                ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM diff summary is missing path")
            fun count(key: String): Int {
                val value = (file.fields[key] as? JsonValue.NumberValue)?.value
                    ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM diff summary $key is missing")
                if (!value.isFinite() || value < 0 || value > Int.MAX_VALUE || value != kotlin.math.floor(value)) {
                    throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM diff summary $key must be a nonnegative integer")
                }
                return value.toInt()
            }
            val added = count("linesAdded")
            val removed = count("linesRemoved")
            val content = diffContents[path]
            diffViewLocked(path, added, removed, content?.preview ?: "pending", content?.texts() != null)
        }
        diffs = rows.toMutableList()
    }

    private fun applyFileDiffLocked(content: FileDiffContent) {
        diffContents[content.path] = content
        val view = diffViewLocked(content.path, content.linesAdded, content.linesRemoved, content.preview, content.texts() != null)
        val existing = diffs.indexOfFirst { it.id == view.id }
        if (existing >= 0) diffs[existing] = view else diffs += view
    }

    private fun diffViewLocked(path: String, added: Int, removed: Int, preview: String, available: Boolean): DiffView {
        if (path !in diffPaths) diffPaths += path
        val label = path.substringAfterLast('/').substringAfterLast('\\')
        return DiffView("diff-${diffPaths.indexOf(path) + 1}", label, added, removed, preview, available)
    }

    private fun usageView(value: JsonValue.ObjectValue?): UsageView? {
        val usage = (value?.fields?.get("usage") as? JsonValue.ObjectValue) ?: value ?: return null
        fun number(vararg keys: String): Int? = keys.firstNotNullOfOrNull { key ->
            (usage.fields[key] as? JsonValue.NumberValue)?.value?.toInt()
        }
        val input = number("inputTokens", "input")
        val output = number("outputTokens", "output")
        val cacheRead = number("cacheReadTokens", "cacheRead")
        val cacheWrite = number("cacheCreationTokens", "cacheWrite")
        if (input == null && output == null && cacheRead == null && cacheWrite == null) return null
        return UsageView(input, output, cacheRead, cacheWrite)
    }

    private fun planItems(plan: JsonValue?): List<PlanItemView> {
        val items = when (plan) {
            is JsonValue.ArrayValue -> plan.items
            is JsonValue.ObjectValue -> (plan.fields["entries"] as? JsonValue.ArrayValue)?.items.orEmpty()
            else -> return emptyList()
        }
        return items.mapNotNull { item ->
            val obj = item as? JsonValue.ObjectValue ?: return@mapNotNull null
            val content = (obj.fields["content"] as? JsonValue.Text)?.value ?: return@mapNotNull null
            PlanItemView(content, (obj.fields["status"] as? JsonValue.Text)?.value ?: "pending")
        }
    }

    private fun desensitizeCatalog(kind: String, result: JsonValue.ObjectValue): List<CatalogRowView> {
        val rows = mutableListOf<CatalogRowView>()
        fun walk(value: JsonValue, fallback: String) {
            when (value) {
                is JsonValue.ObjectValue -> {
                    val name = (value.fields["name"] as? JsonValue.Text)?.value
                        ?: (value.fields["id"] as? JsonValue.Text)?.value
                        ?: (value.fields["label"] as? JsonValue.Text)?.value
                    val detail = (value.fields["description"] as? JsonValue.Text)?.value
                        ?: (value.fields["status"] as? JsonValue.Text)?.value
                        ?: (value.fields["type"] as? JsonValue.Text)?.value
                    if (name != null) rows += CatalogRowView(redact(name), redact(detail ?: kind))
                    value.fields.forEach { (key, child) ->
                        if (key in CATALOG_COLLECTIONS) walk(child, key)
                    }
                }
                is JsonValue.ArrayValue -> value.items.forEachIndexed { index, item -> walk(item, "$fallback-$index") }
                else -> Unit
            }
        }
        walk(result, kind)
        if (rows.isEmpty()) rows += CatalogRowView(kind, "loaded")
        return rows.take(50)
    }

    private fun redact(text: String): String =
        text
            .replace(Regex("(/Users|/home|C:\\\\)[^\\s]+"), "[path]")
            .replace(Regex("(?i)(token|secret|key|password)=\\S+"), "[redacted]")
            .take(160)

    private data class Quadruple<A, B, C, D>(val first: A, val second: B, val third: C, val fourth: D)

    companion object {
        private val CATALOG_COLLECTIONS = setOf(
            "skills", "hooks", "plugins", "profiles", "spaces", "items", "turns", "tools", "permissionProfiles",
        )
    }
}
