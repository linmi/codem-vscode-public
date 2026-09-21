package com.codem.intellij.webview

import com.codem.intellij.core.JsonValue
import com.codem.intellij.core.encodeJson
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLifeSpanHandlerAdapter
import org.cef.handler.CefLoadHandlerAdapter
import org.cef.handler.CefRequestHandlerAdapter
import org.cef.network.CefRequest
import java.awt.BorderLayout
import java.nio.file.Path
import javax.swing.JPanel
import javax.swing.SwingUtilities

/**
 * JCEF 消息桥草稿。入站用 JSQuery 转发 UI 的 postMessage；出站仍把 JSON 拼进 executeJavaScript。
 * 不能当作已完成的安全桥。导航必须先过 ResourcePolicy.allowNavigation。
 *
 * 更改要点：onLoadEnd 补 Ready；出站只有快照，宿主不向页面注入动作。
 */
class JcefHostPanel(
    private val resourceRoot: Path,
    private var theme: IdeTheme.Tokens,
    private val onAction: (ViewAction) -> Unit,
) : JPanel(BorderLayout()) {
    private val log = com.intellij.openapi.diagnostic.Logger.getInstance(JcefHostPanel::class.java)
    private val browser = JBCefBrowser()
    private val query = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase)
    private var viewGeneration = 0L
    private var ready = false
    private var queued: JsonValue? = null

    init {
        background = theme.swingBackground
        isOpaque = true
        browser.component.background = theme.swingBackground
        browser.component.isOpaque = true
        query.addHandler { payload ->
            val generation = viewGeneration
            try {
                if (generation != viewGeneration) {
                    return@addHandler JBCefJSQuery.Response("", 409, "stale view")
                }
                val action = parseViewAction(JsonValue.parse(payload))
                log.info("CodeM inbound ${action.javaClass.simpleName}")
                onAction(action)
            } catch (error: Exception) {
                log.warn("CodeM inbound action rejected")
                return@addHandler JBCefJSQuery.Response("", 400, error.message ?: "invalid action")
            }
            JBCefJSQuery.Response("ok")
        }
        browser.jbCefClient.addRequestHandler(
            object : CefRequestHandlerAdapter() {
                override fun onBeforeBrowse(
                    cefBrowser: CefBrowser?,
                    frame: CefFrame?,
                    request: CefRequest?,
                    userGesture: Boolean,
                    isRedirect: Boolean,
                ): Boolean {
                    val url = request?.url ?: return true
                    val allowed = ResourcePolicy.allowNavigation(url, resourceRoot)
                    if (!allowed) log.warn("CodeM blocked a navigation")
                    return !allowed
                }
            },
            browser.cefBrowser,
        )
        browser.jbCefClient.addLifeSpanHandler(
            object : CefLifeSpanHandlerAdapter() {
                override fun onBeforePopup(
                    cefBrowser: CefBrowser?,
                    frame: CefFrame?,
                    targetUrl: String?,
                    targetFrameName: String?,
                ): Boolean = true
            },
            browser.cefBrowser,
        )
        browser.jbCefClient.addLoadHandler(
            object : CefLoadHandlerAdapter() {
                override fun onLoadEnd(cefBrowser: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
                    if (frame?.isMain != true || cefBrowser == null) return
                    injectTheme(cefBrowser, frame.url)
                    injectInbound(cefBrowser, frame.url)
                    // 脚本已执行完毕；入站监听可能晚于 UI 的 ready，出站刷新首屏并补一次 Ready。
                    ready = true
                    queued?.let { deliver(it) }
                    queued = null
                    onAction(ViewAction.Ready)
                }

                override fun onLoadError(
                    cefBrowser: CefBrowser?,
                    frame: CefFrame?,
                    errorCode: org.cef.handler.CefLoadHandler.ErrorCode?,
                    errorText: String?,
                    failedUrl: String?,
                ) {
                    if (frame?.isMain == true) log.warn("CodeM UI failed to load")
                }
            },
            browser.cefBrowser,
        )
        add(browser.component, BorderLayout.CENTER)
        val index = ResourcePolicy.resolve(resourceRoot, "index.html").first
        browser.loadURL(index.toUri().toString())
    }

    /** 出站快照使用与 @codem/ui 相同的字段；桥本身仍是 executeJavaScript 草稿。 */
    fun postSnapshot(snapshot: ChatSnapshot) {
        post(encodeChatSnapshot(snapshot))
    }

    fun post(message: JsonValue) {
        if (!SwingUtilities.isEventDispatchThread()) {
            SwingUtilities.invokeLater { post(message) }
            return
        }
        if (!ready) {
            queued = message
            return
        }
        deliver(message)
    }

    /**
     * LAF 切换后重涂 Swing/JCEF 底色并注入 VS Code CSS 变量。
     * 不重载页面，避免丢掉当前对话。
     */
    fun applyTheme(tokens: IdeTheme.Tokens) {
        if (!SwingUtilities.isEventDispatchThread()) {
            SwingUtilities.invokeLater { applyTheme(tokens) }
            return
        }
        if (theme.synara == tokens.synara && theme.dark == tokens.dark) return
        theme = tokens
        background = tokens.swingBackground
        isOpaque = true
        browser.component.background = tokens.swingBackground
        browser.component.isOpaque = true
        browser.cefBrowser.executeJavaScript(IdeTheme.injectScript(tokens), "codem://host", 0)
    }

    fun disposeBridge() {
        viewGeneration += 1
        ready = false
        query.dispose()
        browser.dispose()
    }

    private fun injectTheme(cefBrowser: CefBrowser, url: String) {
        cefBrowser.executeJavaScript(IdeTheme.injectScript(theme), url, 0)
    }

    private fun injectInbound(cefBrowser: CefBrowser, url: String) {
        val send = query.inject("payload")
        // onLoadEnd 可能多次触发；重复 addEventListener 会把一次点击打成多次 signIn。
        cefBrowser.executeJavaScript(
            """
            window.__codemQuery = function(payload) { $send };
            if (!window.__codemBridgeInstalled) {
              window.__codemBridgeInstalled = true;
              window.addEventListener('message', function(event) {
                var data = event.data;
                if (!data || data.source !== 'codem-ui' || !data.action) return;
                window.__codemQuery(JSON.stringify(data.action));
              });
            }
            """.trimIndent(),
            url,
            0,
        )
    }

    private fun deliver(message: JsonValue) {
        // 出站仍把 JSON 拼进脚本，未完成安全桥。
        val encoded = encodeJson(message).replace("\\", "\\\\").replace("'", "\\'")
        browser.cefBrowser.executeJavaScript(
            "window.__codemHostReceive && window.__codemHostReceive('$encoded')",
            "codem://host",
            0,
        )
    }
}
