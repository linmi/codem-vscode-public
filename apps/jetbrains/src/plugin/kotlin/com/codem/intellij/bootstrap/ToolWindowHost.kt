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
import com.codem.intellij.webview.IdeTheme
import com.codem.intellij.webview.JcefHostPanel
import com.codem.intellij.webview.SelectionView
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
    @Volatile private var local = themed(initialSnapshot())

    init {
        ApplicationManager.getApplication().messageBus.connect(project)
            .subscribe(LafManagerListener.TOPIC, LafManagerListener {
                ApplicationManager.getApplication().invokeLater {
                    if (!project.isDisposed) publish(current())
                }
            })
        // 重载后 UI ready 可能丢；不靠用户再点登录，后台直接读本机 CLI 登录态并自动连接。
        runBackground { refreshAccount() }
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
            is ViewAction.PickAttachment -> pickAttachment(action.kind)
            is ViewAction.SetTheme -> applyTheme(action.theme)
            is ViewAction.OpenDiff -> openDiff(action.id)
            is ViewAction.RemoveAttachment -> removeAttachment(action.id)
            else -> applyOnSession(action)
        }
    }

    fun dispose() {
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
            val session = createSession(runtime, cwd, trusted = true)
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
                sessionRef.set(session)
                val visible = if (snapshot.phase == "ready") snapshot.copy(notice = null) else snapshot
                publish(visible.withLocalAccount())
                if (snapshot.phase == "ready") {
                    log.info("CodeM connection finished")
                } else {
                    log.warn("CodeM connection did not reach ready: phase=${snapshot.phase} notice=${snapshot.notice}")
                }
            } catch (error: Throwable) {
                if (connectGeneration.get() != generation) return
                sessionRef.set(session)
                publish(session.snapshot().copy(notice = SafeNotice.from(error, HostLoadingFeedback.CONNECT_TIMEOUT), canRetry = true, phase = "failed"))
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
        loginRef.getAndSet(null)?.cancel()
        sessionRef.getAndSet(null)?.close()
        autoConnectAttempted.set(false)
        publishAccount(AccountProjection.signedOut())
    }

    /** 未连接时先连再发，对齐 VS Code 首次发送。输入栏按钮与待发送文件都走这里。 */
    private fun sendOrConnect(action: ViewAction.Send) {
        runBackground { deliverSend(action) }
    }

    private fun deliverSend(action: ViewAction.Send) {
        if (sessionRef.get() == null) {
            autoConnectAttempted.set(true)
            connect()
        }
        val session = sessionRef.get()
        if (session == null) {
            publish(current().copy(notice = "CodeM is not connected", version = current().version + 1))
            return
        }
        try {
            log.info("CodeM turn/start requestId=${action.requestId}")
            session.applyViewAction(action)
            publish(session.snapshot())
        } catch (error: Throwable) {
            publish(session.snapshot().copy(notice = SafeNotice.from(error, "CodeM action failed")))
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
            publish(local.copy(notice = "CodeM is not connected", version = local.version + 1))
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
            val resolved = RuntimeLocator.resolveFromSearchRoots(RuntimeLocator.pluginSearchRoots(pluginRoot, workingDirectory()))
            log.info("CodeM locked runtime located")
            resolved
        } catch (error: Throwable) {
            publish(failed(SafeNotice.from(error, "CodeM locked runtime is not bundled")))
            null
        }
    }

    private fun createSession(runtime: ResolvedRuntime, cwd: Path, trusted: Boolean): ProjectSession =
        ProjectSession(
            runtime = runtime,
            workingDirectory = cwd,
            trusted = trusted,
            selectionReader = selectionReader,
            attachmentStore = attachments,
            diffPresenter = diffs,
            historySource = historySource(),
            directoryPicker = { null },
            onSnapshot = { snapshot -> publish(snapshot.withLocalAccount()) },
        )

    /**
     * A08 历史分页读的是 Core 自己的 JSONL，不是插件另存的副本。
     * 根目录按 Core 顺序解析环境变量，越界与符号链接由 HistoryReplay 拒绝。
     */
    private fun historySource(): HistorySource = HistorySource { cwd, threadId, cursor ->
        val root = SessionsRoot.resolve(System.getenv(), Path.of(System.getProperty("user.home")))
        HistoryReplay.read(root, cwd, threadId, cursor = cursor)
    }

    private fun workingDirectory(): Path? = project.basePath?.let { Path.of(it) }

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
