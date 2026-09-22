package com.codem.intellij.bootstrap

import com.codem.intellij.account.AccountProjection
import com.codem.intellij.account.AuthClient
import com.codem.intellij.account.LoginOperation
import com.codem.intellij.webview.AccountView
import com.codem.intellij.core.CodemError
import com.codem.intellij.core.ResolvedRuntime
import com.codem.intellij.core.RuntimeLocator
import com.codem.intellij.ide.AttachmentStore
import com.codem.intellij.ide.IdeaAttachmentStore
import com.codem.intellij.ide.IdeaDiffPresenter
import com.codem.intellij.ide.IdeaSelectionReader
import com.codem.intellij.ide.IdeaWorkspaceTrust
import com.codem.intellij.ide.PathGuard
import com.codem.intellij.ide.SelectionReader
import com.codem.intellij.history.HistoryReplay
import com.codem.intellij.history.SessionsRoot
import com.codem.intellij.ide.HistorySource
import com.codem.intellij.session.HostLoadingFeedback
import com.codem.intellij.session.ProjectSession
import com.codem.intellij.session.SafeNotice
import com.codem.intellij.webview.AttachmentView
import com.codem.intellij.webview.ChatSnapshot
import com.codem.intellij.webview.FileHitView
import com.codem.intellij.webview.FileSearchView
import com.codem.intellij.webview.IdeTheme
import com.codem.intellij.webview.JcefHostPanel
import com.codem.intellij.webview.SelectionView
import com.codem.intellij.webview.SubmissionReceiptView
import com.codem.intellij.webview.submissionRequestId
import com.codem.intellij.webview.ViewAction
import com.codem.intellij.webview.initialSnapshot
import com.intellij.ide.BrowserUtil
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.project.Project
import java.nio.file.Path
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * Tool Window 宿主：首屏只发 initialSnapshot，连接/登录在后台线程。
 * 不向界面暴露路径、协议帧或密钥。
 *
 * 更改要点：构造即读登录态，不依赖 JCEF ready 竞态；已登录自动连 Core；
 * auth status / connect 有独立看门狗，超时必须下发失败+重试，不能停在 checking。
 */
class ToolWindowHost(
    private val project: Project,
    private val panel: JcefHostPanel,
    private val pluginRoot: Path?,
    private val selectionReader: SelectionReader = IdeaSelectionReader(project),
    private val trust: IdeaWorkspaceTrust = IdeaWorkspaceTrust(project),
    private val attachments: AttachmentStore = IdeaAttachmentStore(project),
    private val diffs: IdeaDiffPresenter = IdeaDiffPresenter(project),
) {
    private val log = Logger.getInstance(ToolWindowHost::class.java)
    private val sessionRef = AtomicReference<ProjectSession?>(null)
    private val loginRef = AtomicReference<LoginOperation?>(null)
    private val loginCancelled = java.util.concurrent.atomic.AtomicBoolean(false)
    private val autoConnectAttempted = java.util.concurrent.atomic.AtomicBoolean(false)
    private val accountRefresh = AtomicBoolean(false)
    private val accountGeneration = AtomicLong(0)
    private val connectInFlight = AtomicBoolean(false)
    private val connectGeneration = AtomicLong(0)
    private val watchdogs = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "codem-host-watchdog").apply { isDaemon = true }
    }
    private val searchedFiles = java.util.concurrent.ConcurrentHashMap<String, Path>()
    @Volatile private var local = themed(initialSnapshot().copy(sendKey = storedSendKey()))

    init {
        ApplicationManager.getApplication().messageBus.connect(project)
            .subscribe(LafManagerListener.TOPIC, LafManagerListener {
                ApplicationManager.getApplication().invokeLater {
                    if (!project.isDisposed) publish(current())
                }
            })
        // 重载后 UI ready 可能丢；不靠用户再点登录，后台直接读本机 CLI 登录态并自动连接。
        runBackground { refreshAccount() }
        watchEditorSelection()
    }

    fun current(): ChatSnapshot = sessionRef.get()?.snapshot()?.withLocalAccount() ?: local

    fun publish(snapshot: ChatSnapshot) {
        // 调用方若要保留 Host 账户，先 withLocalAccount；这里不再回写成旧 local.account，
        // 否则 publishAccount(signedIn) 会被 checking 盖掉，界面永远只剩 Logo。
        val next = themed(snapshot.copy(brandMark = snapshot.brandMark ?: local.brandMark))
        local = next
        panel.applyTheme(IdeTheme.current())
        panel.postSnapshot(next)
    }

    fun handle(action: ViewAction) {
        // 入站必须落日志：死按钮时 idea.log 能证明点击是否到达 Host。
        log.info("CodeM view action ${action.javaClass.simpleName}")
        when (action) {
            ViewAction.Ready -> {
                publish(current())
                runBackground {
                    // 重复 Ready 复用已完成的登录态，避免再起一个会堵死的 auth status。
                    val status = current().account.status
                    if (status == "checking" || status == "error") refreshAccount()
                    else maybeAutoConnect()
                }
            }
            ViewAction.Connect -> runBackground { connect() }
            ViewAction.SignIn -> beginSignIn()
            ViewAction.SignOut -> signOut()
            ViewAction.RefreshAccount -> runBackground { refreshAccount() }
            ViewAction.CancelSignIn -> cancelLogin()
            is ViewAction.Send -> sendOrConnect(action)
            ViewAction.PinSelection -> pinSelection()
            is ViewAction.RemoveSelection -> removeSelection(action.id)
            is ViewAction.SearchFiles -> runBackground { searchFiles(action) }
            is ViewAction.SelectFile -> runBackground { selectSearchedFile(action) }
            is ViewAction.PasteImages -> runBackground { pasteImages(action) }
            is ViewAction.SetSendKey -> rememberSendKey(action.sendKey)
            is ViewAction.PickAttachment -> pickAttachment(action.kind)
            is ViewAction.SetTheme -> applyTheme(action.theme)
            is ViewAction.OpenDiff -> openDiff(action.id)
            is ViewAction.RemoveAttachment -> removeAttachment(action.id)
            else -> applyOnSession(action)
        }
    }

    fun dispose() {
        connectGeneration.incrementAndGet()
        cancelLogin()
        watchdogs.shutdownNow()
        sessionRef.getAndSet(null)?.close()
    }

    private fun connect() {
        if (!connectInFlight.compareAndSet(false, true)) {
            log.info("CodeM connection already in progress")
            return
        }
        val generation = connectGeneration.incrementAndGet()
        try {
            val runtime = locateRuntime() ?: return
            val cwd = workingDirectory() ?: run {
                log.warn("CodeM connection aborted: no project directory")
                publish(failed("CodeM requires a trusted project before starting Core"))
                return
            }
            if (!trust.isTrusted(cwd)) {
                log.warn("CodeM connection aborted: workspace is not trusted")
                publish(failed("CodeM requires a trusted project before starting Core"))
                return
            }
            log.info("CodeM workspace trust accepted")
            publish(
                local.copy(
                    phase = "connecting",
                    notice = HostLoadingFeedback.CONNECTING,
                    canRetry = false,
                    version = local.version + 1,
                ),
            )
            scheduleConnectWatchdog(generation)
            val session = sessionRef.get() ?: createSession(runtime, cwd, trusted = true).also { sessionRef.set(it) }
            try {
                var snapshot = session.connect()
                if (snapshot.notice == "Select a space to continue") {
                    val spaceId = snapshot.composerCatalog.spaces.firstOrNull()?.id
                    if (spaceId != null) {
                        log.info("CodeM auto-selecting space")
                        snapshot = session.chooseSpace(spaceId)
                    }
                }
                if (connectGeneration.get() != generation) {
                    log.info("CodeM connection ignored stale result")
                    session.close()
                    return
                }
                session.rememberSendKey(storedSendKey())
                val visible = if (snapshot.phase == "ready") snapshot.copy(notice = null, sendKey = storedSendKey()) else snapshot.copy(sendKey = storedSendKey())
                publish(visible.withLocalAccount())
                if (snapshot.phase == "ready") {
                    log.info("CodeM connection finished")
                } else {
                    log.warn("CodeM connection did not reach ready: phase=${snapshot.phase} notice=${snapshot.notice}")
                }
            } catch (error: Throwable) {
                if (connectGeneration.get() != generation) return
                publish(session.snapshot().copy(notice = SafeNotice.from(error, HostLoadingFeedback.CONNECT_TIMEOUT)).withLocalAccount())
                log.warn("CodeM connection failed", error)
            }
        } finally {
            if (connectGeneration.get() == generation) connectInFlight.set(false)
        }
    }

    /**
     * 与 VS Code account.login() 对齐：点击当下就把 account 写成 signingIn/opening，
     * 再后台跑 CLI。不能先 locateRuntime 再回写，否则登录页一直是死按钮。
     */
    private fun beginSignIn() {
        val status = current().account.status
        val progress = current().account.progress
        if (status == "signingIn" && progress != "cancelling") {
            log.info("CodeM sign-in already in progress")
            return
        }
        loginCancelled.set(false)
        publishAccount(AccountProjection.signingIn("opening"))
        runBackground { signIn() }
    }

    private fun signIn() {
        if (loginCancelled.get()) {
            publishAccount(AccountProjection.cancelled())
            return
        }
        val runtime = locateRuntime() ?: run {
            publishAccount(AccountProjection.error("登录未完成，请重试。"))
            return
        }
        val cwd = workingDirectory() ?: Path.of(System.getProperty("user.home"))
        val client = AuthClient(runtime, cwd)
        try {
            val status = client.status()
            if (loginCancelled.get()) {
                publishAccount(AccountProjection.cancelled())
                return
            }
            if (status.loggedIn && status.routerCredential == true) {
                publishAccount(AccountProjection.fromStatus(status))
                maybeAutoConnect()
                log.info("CodeM already signed in")
                return
            }
            val operation = client.startLogin(
                presentAuthorization = { url ->
                    ApplicationManager.getApplication().invokeLater { BrowserUtil.browse(url) }
                },
                onProgress = { progress ->
                    if (!loginCancelled.get()) publishAccount(AccountProjection.fromLoginProgress(progress))
                },
            )
            loginRef.set(operation)
            if (loginCancelled.get()) {
                operation.cancel()
                publishAccount(AccountProjection.cancelled())
                return
            }
            operation.awaitSuccess()
            loginRef.compareAndSet(operation, null)
            publishAccount(AccountProjection.fromStatus(client.status()))
            maybeAutoConnect()
            log.info("CodeM sign-in finished")
        } catch (error: Throwable) {
            if (loginCancelled.get() || (error is CodemError && error.errorClass == CodemError.Class.Cancelled)) {
                publishAccount(AccountProjection.cancelled())
            } else {
                publishAccount(AccountProjection.error("登录未完成，请重试。"))
                log.warn("CodeM sign-in failed", error)
            }
        }
    }

    /** 只读 auth status，不打开浏览器、不打 Core。进行中的读取合并，超时由看门狗落到 error。 */
    private fun refreshAccount() {
        if (current().account.status == "signingIn") return
        if (!accountRefresh.compareAndSet(false, true)) {
            log.info("CodeM account status already in progress")
            return
        }
        val generation = accountGeneration.incrementAndGet()
        log.info("CodeM account status starting")
        scheduleAccountWatchdog(generation)
        val started = System.currentTimeMillis()
        try {
            val runtime = locateRuntime() ?: run {
                if (accountGeneration.get() == generation) {
                    publishAccount(AccountProjection.error(HostLoadingFeedback.ACCOUNT_FAILED))
                }
                return
            }
            val status = AuthClient(runtime, workingDirectory() ?: Path.of(System.getProperty("user.home"))).status()
            if (accountGeneration.get() != generation) {
                log.info("CodeM account status ignored stale result")
                return
            }
            publishAccount(AccountProjection.fromStatus(status))
            accountGeneration.compareAndSet(generation, generation + 1)
            log.info("CodeM account status loggedIn=${status.loggedIn} ${System.currentTimeMillis() - started}ms")
            maybeAutoConnect()
        } catch (error: Throwable) {
            if (accountGeneration.get() != generation) return
            publishAccount(AccountProjection.error(HostLoadingFeedback.ACCOUNT_FAILED))
            log.warn("CodeM account refresh failed", error)
        } finally {
            if (accountGeneration.get() == generation) accountRefresh.set(false)
        }
    }

    private fun scheduleAccountWatchdog(generation: Long) {
        watchdogs.schedule({
            if (accountGeneration.get() != generation) return@schedule
            if (!HostLoadingFeedback.accountStillPending(current().account.status)) return@schedule
            accountGeneration.compareAndSet(generation, generation + 1)
            accountRefresh.set(false)
            publishAccount(AccountProjection.error(HostLoadingFeedback.ACCOUNT_TIMEOUT))
            log.warn("CodeM account status still checking after ${HostLoadingFeedback.ACCOUNT_MS}ms")
        }, HostLoadingFeedback.ACCOUNT_MS, TimeUnit.MILLISECONDS)
    }

    private fun scheduleConnectWatchdog(generation: Long) {
        watchdogs.schedule({
            if (connectGeneration.get() != generation) return@schedule
            if (!HostLoadingFeedback.connectStillPending(current().phase)) return@schedule
            connectGeneration.compareAndSet(generation, generation + 1)
            connectInFlight.set(false)
            publish(failed(HostLoadingFeedback.CONNECT_TIMEOUT))
            log.warn("CodeM connection still connecting after ${HostLoadingFeedback.CONNECT_MS}ms")
        }, HostLoadingFeedback.CONNECT_MS, TimeUnit.MILLISECONDS)
    }

    private fun cancelLogin() {
        if (current().account.status != "signingIn") return
        loginCancelled.set(true)
        publishAccount(AccountProjection.cancelling())
        loginRef.getAndSet(null)?.cancel()
    }

    private fun publishAccount(account: AccountView) {
        publish(current().copy(account = account, version = current().version + 1))
    }

    /** 已登录后自动连 Core，对齐 VS Code autoConnect；不把「连接」做成主按钮。 */
    private fun maybeAutoConnect() {
        val snap = current()
        if (snap.account.status != "signedIn") return
        if (snap.phase != "disconnected") return
        if (!autoConnectAttempted.compareAndSet(false, true)) return
        connect()
    }

    private fun signOut() {
        connectGeneration.incrementAndGet()
        connectInFlight.set(false)
        loginRef.getAndSet(null)?.cancel()
        sessionRef.getAndSet(null)?.close()
        autoConnectAttempted.set(false)
        publishAccount(AccountProjection.signedOut())
    }

    /** 未连接时先连再发，对齐 VS Code 首次发送。输入栏发送走这里。 */
    private fun sendOrConnect(action: ViewAction.Send) {
        runBackground { deliverSend(action) }
    }

    private fun deliverSend(action: ViewAction.Send) {
        try {
            if (sessionRef.get() == null) {
                autoConnectAttempted.set(true)
                connect()
            }
            val session = sessionRef.get()
            if (session == null) {
                publish(current().copy(
                    notice = "CodeM is not connected", version = current().version + 1,
                    submission = SubmissionReceiptView(action.requestId, false),
                ))
                return
            }
            log.info("CodeM turn/start requestId=${action.requestId}")
            session.applyViewAction(action)
        } catch (error: Throwable) {
            publish(current().copy(
                notice = SafeNotice.from(error, "CodeM action failed"),
                submission = SubmissionReceiptView(action.requestId, false),
                version = current().version + 1,
            ))
            log.warn("CodeM turn/start failed", error)
        }
    }

    private fun ChatSnapshot.withLocalAccount(): ChatSnapshot =
        copy(account = local.account, brandMark = local.brandMark ?: brandMark)

    private fun pinSelection() {
        val session = sessionRef.get()
        if (session != null) {
            session.pinSelection()
            publish(session.snapshot())
            return
        }
        val snap = selectionReader.current()
        if (snap == null) {
            publish(local.copy(notice = "CodeM has no editor selection", version = local.version + 1))
            return
        }
        val file = snap.path.substringAfterLast('/').substringAfterLast('\\')
        publish(
            local.copy(
                selections = listOf(SelectionView("sel-local", "$file:${snap.startLine}-${snap.endLine}")),
                notice = null,
                version = local.version + 1,
            ),
        )
    }

    private fun pickAttachment(kind: String) {
        ApplicationManager.getApplication().invokeLater {
            val descriptor = if (kind == "directory") {
                FileChooserDescriptorFactory.createSingleFolderDescriptor()
            } else {
                FileChooserDescriptorFactory.createSingleFileNoJarsDescriptor()
            }
            val chosen = FileChooser.chooseFile(descriptor, project, null) ?: return@invokeLater
            runBackground { attachChosen(kind, chosen.toNioPath()) }
        }
    }

    private fun attachChosen(kind: String, path: Path) {
        val session = sessionRef.get()
        val storeKind = attachmentKind(kind, path)
        try {
            if (session != null) {
                session.attach(path, storeKind)
                publish(session.snapshot())
                return
            }
            val root = project.basePath?.let { Path.of(it) } ?: throw CodemError.Validation("CodeM has no project directory")
            val bound = PathGuard.bind(root, path)
            attachments.validate(bound, storeKind)
            val view = AttachmentView("att-local", bound.fileName.toString(), storeKind.name.lowercase())
            publish(local.copy(attachments = local.attachments + view, notice = null, version = local.version + 1))
        } catch (error: Throwable) {
            publish(current().copy(notice = SafeNotice.from(error, "CodeM attachment failed"), version = current().version + 1))
        }
    }

    private fun applyTheme(theme: String) {
        sessionRef.get()?.setTheme(theme)
        publish(current().copy(theme = theme, version = current().version + 1))
    }

    private fun openDiff(id: String) {
        val session = sessionRef.get()
        if (session == null) {
            publish(local.copy(notice = "CodeM has no diff to open", version = local.version + 1))
            return
        }
        try {
            session.openDiff(id)
            publish(session.snapshot())
        } catch (error: Throwable) {
            publish(session.snapshot().copy(notice = SafeNotice.from(error, "CodeM diff is not available")))
        }
    }

    private fun removeAttachment(id: String) {
        val session = sessionRef.get()
        if (session != null) {
            session.removeAttachment(id)
            publish(session.snapshot())
            return
        }
        publish(local.copy(attachments = local.attachments.filterNot { it.id == id }, version = local.version + 1))
    }

    private fun applyOnSession(action: ViewAction) {
        val session = sessionRef.get()
        if (session == null) {
            publish(local.copy(
                notice = "CodeM is not connected", version = local.version + 1,
                submission = action.submissionRequestId()?.let { SubmissionReceiptView(it, false) } ?: local.submission,
            ))
            return
        }
        runBackground {
            try {
                session.applyViewAction(action)
                publish(session.snapshot())
            } catch (error: Throwable) {
                publish(session.snapshot().copy(notice = SafeNotice.from(error, "CodeM action failed")))
            }
        }
    }

    private fun locateRuntime(): ResolvedRuntime? {
        return try {
            val resolved = RuntimeLocator.resolveFromPlugin(pluginRoot ?: throw CodemError.Validation("CodeM plugin installation directory is unavailable"))
            log.info("CodeM locked runtime located")
            resolved
        } catch (error: Throwable) {
            publish(failed(SafeNotice.from(error, "CodeM locked runtime is not bundled")))
            null
        }
    }

    private fun createSession(runtime: ResolvedRuntime, cwd: Path, trusted: Boolean): ProjectSession {
        lateinit var created: ProjectSession
        created = ProjectSession(
            runtime = runtime,
            workingDirectory = cwd,
            trusted = trusted,
            selectionReader = selectionReader,
            attachmentStore = attachments,
            diffPresenter = diffs,
            historySource = historySource(),
            directoryPicker = { chooseDirectory() },
            onSnapshot = { snapshot ->
                if (sessionRef.get() === created) publish(snapshot.withLocalAccount())
            },
        )
        return created
    }

    /**
     * A08 历史分页读的是 Core 自己的 JSONL，不是插件另存的副本。
     * 根目录按 Core 顺序解析环境变量，越界与符号链接由 HistoryReplay 拒绝。
     */
    private fun historySource(): HistorySource = HistorySource { cwd, threadId, cursor ->
        val root = SessionsRoot.resolve(System.getenv(), Path.of(System.getProperty("user.home")))
        HistoryReplay.read(root, cwd, threadId, cursor = cursor)
    }

    private fun workingDirectory(): Path? = project.basePath?.let { Path.of(it) }

    /** 跟随编辑器划选。钉住之前只是一条可移除的当前选区。 */
    private fun watchEditorSelection() {
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            com.intellij.openapi.editor.EditorFactory.getInstance().eventMulticaster.addSelectionListener(
                object : com.intellij.openapi.editor.event.SelectionListener {
                    override fun selectionChanged(event: com.intellij.openapi.editor.event.SelectionEvent) {
                        if (event.editor.project != project) return
                        publishLiveSelection()
                    }
                },
                project,
            )
        }
    }

    private fun publishLiveSelection() {
        val session = sessionRef.get() ?: return
        val snap = selectionReader.current()
        if (snap == null || snap.text.isEmpty()) session.setLiveSelection(null, 1, 1, "")
        else session.setLiveSelection(snap.path, snap.startLine, snap.endLine, snap.text)
        publish(session.snapshot().withLocalAccount())
    }

    private fun removeSelection(id: String) {
        val session = sessionRef.get()
        if (session != null) {
            session.removeSelection(id)
            publish(session.snapshot().withLocalAccount())
            return
        }
        publish(local.copy(selections = local.selections.filterNot { it.id == id }, version = local.version + 1))
    }

    /** 额外目录用 IDEA 的目录框，不再固定返回空。必须在 EDT 上选。 */
    private fun chooseDirectory(): Path? {
        val chosen = java.util.concurrent.atomic.AtomicReference<Path?>(null)
        ApplicationManager.getApplication().invokeAndWait {
            val file = FileChooser.chooseFile(FileChooserDescriptorFactory.createSingleFolderDescriptor(), project, null)
            chosen.set(file?.toNioPath())
        }
        return chosen.get()
    }

    private fun searchFiles(action: ViewAction.SearchFiles) {
        val root = workingDirectory()
        val session = sessionRef.get()
        if (root == null || session == null) {
            publishSearch(FileSearchView(action.requestId, "error", emptyList(), "请先打开受信任的项目"))
            return
        }
        publishSearch(FileSearchView(action.requestId, "loading"))
        val hits = try {
            com.codem.intellij.ide.WorkspaceFileSearch.search(root, action.query)
        } catch (error: Throwable) {
            publishSearch(FileSearchView(action.requestId, "error", emptyList(), "工作区文件搜索失败"))
            log.warn("CodeM file search failed", error)
            return
        }
        searchedFiles.clear()
        val files = hits.mapIndexed { index, relative ->
            val id = "file-${index + 1}"
            searchedFiles[id] = root.resolve(relative)
            FileHitView(id, relative)
        }
        publishSearch(FileSearchView(action.requestId, if (files.isEmpty()) "empty" else "ready", files, if (files.isEmpty()) "没有匹配的文件" else null))
    }

    private fun selectSearchedFile(action: ViewAction.SelectFile) {
        val path = searchedFiles[action.id]
        val session = sessionRef.get()
        if (path == null || session == null) {
            publishSearch(FileSearchView(action.requestId, "error", emptyList(), "文件已变化或搜索结果已过期，请重新输入 @ 搜索。"))
            return
        }
        try {
            session.attach(path, com.codem.intellij.ide.AttachmentStore.Kind.File)
            session.publishFileSearch(null)
            publish(session.snapshot().withLocalAccount())
        } catch (error: Throwable) {
            publishSearch(FileSearchView(action.requestId, "error", emptyList(), SafeNotice.from(error, "无法添加这个文件")))
        }
    }

    private fun pasteImages(action: ViewAction.PasteImages) {
        val session = sessionRef.get() ?: run {
            publish(local.copy(notice = "请先连接后再粘贴图片", version = local.version + 1))
            return
        }
        if (session.snapshot().attachments.size + action.images.size > 20) {
            publish(session.snapshot().copy(notice = "每条消息最多添加 20 个附件").withLocalAccount())
            return
        }
        try {
            var total = 0
            for (image in action.images) {
                val bytes = java.util.Base64.getDecoder().decode(image.data)
                total += bytes.size
                if (bytes.isEmpty() || total > 20 * 1024 * 1024) throw com.codem.intellij.core.CodemError.Validation("单次粘贴的图片合计不能超过 20 MiB。")
                val suffix = when (image.mediaType) {
                    "image/png" -> ".png"
                    "image/jpeg" -> ".jpg"
                    "image/gif" -> ".gif"
                    else -> ".webp"
                }
                val file = java.nio.file.Files.createTempFile("codem-paste", suffix)
                java.nio.file.Files.write(file, bytes)
                session.attachPastedImage(file)
            }
            publish(session.snapshot().withLocalAccount())
        } catch (error: Throwable) {
            publish(session.snapshot().copy(notice = SafeNotice.from(error, "图片粘贴失败，请重新复制后重试。")).withLocalAccount())
            log.warn("CodeM image paste failed", error)
        }
    }

    private fun rememberSendKey(sendKey: String) {
        com.intellij.ide.util.PropertiesComponent.getInstance().setValue("codem.chat.sendKey", sendKey)
        val session = sessionRef.get()
        if (session != null) {
            session.rememberSendKey(sendKey)
            publish(session.snapshot().withLocalAccount())
        } else {
            publish(local.copy(sendKey = sendKey, version = local.version + 1))
        }
    }

    private fun storedSendKey(): String {
        val value = com.intellij.ide.util.PropertiesComponent.getInstance().getValue("codem.chat.sendKey", "enter")
        return if (value == "modEnter") "modEnter" else "enter"
    }

    private fun publishSearch(search: com.codem.intellij.webview.FileSearchView) {
        val session = sessionRef.get()
        if (session != null) {
            session.publishFileSearch(search)
            publish(session.snapshot().withLocalAccount())
        } else {
            publish(local.copy(fileSearch = search, version = local.version + 1))
        }
    }

    private fun failed(notice: String): ChatSnapshot =
        local.copy(phase = "failed", notice = notice, canRetry = true, version = local.version + 1)

    private fun themed(snapshot: ChatSnapshot): ChatSnapshot {
        val tokens = IdeTheme.current()
        return snapshot.copy(
            theme = if (tokens.dark) "dark" else "light",
            account = snapshot.account,
            brandMark = snapshot.brandMark ?: tokens.brandMark,
        )
    }

    private fun attachmentKind(kind: String, path: Path): AttachmentStore.Kind {
        if (kind == "directory") return AttachmentStore.Kind.Directory
        val extension = path.fileName.toString().substringAfterLast('.', "").lowercase()
        return if (extension in IMAGE_EXTENSIONS) AttachmentStore.Kind.Image else AttachmentStore.Kind.File
    }

    private fun runBackground(work: () -> Unit) {
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                work()
            } catch (error: Throwable) {
                publish(current().copy(notice = SafeNotice.from(error, "CodeM action failed"), version = current().version + 1))
            }
        }
    }

    companion object {
        private val IMAGE_EXTENSIONS = setOf("png", "jpg", "jpeg", "gif", "webp")
    }
}
