package com.codem.intellij.bootstrap

import com.codem.intellij.webview.IdeTheme
import com.codem.intellij.webview.JcefHostPanel
import com.codem.intellij.webview.UiBundle
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.content.ContentFactory
import java.awt.BorderLayout
import java.nio.file.Path
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.SwingConstants

/**
 * JCEF 可用且 UI 产物存在时挂上共享界面；否则只显示原生说明，不暗中打开外站或再写一套聊天。
 */
class CodemToolWindowFactory : ToolWindowFactory, DumbAware {
    private val log = Logger.getInstance(CodemToolWindowFactory::class.java)

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        // 2026 把 JCEF 拆成独立插件；缺依赖时 isSupported 会直接 NoClassDefFound，必须接住并降级。
        val component = try {
            if (JBCefApp.isSupported()) {
                createBrowser(project, toolWindow.disposable)
            } else {
                log.warn("CodeM JCEF is not supported")
                fallbackPanel("此 IDE 未启用 JCEF，无法加载 CodeM 界面。<br/>请使用带嵌入式浏览器的 IntelliJ IDEA 2024.3+。日志：Help → Show Log in Finder，搜索 CodeM。")
            }
        } catch (error: LinkageError) {
            log.warn("CodeM JCEF classes are not visible", error)
            fallbackPanel("此 IDE 未把 JCEF 提供给 CodeM。请确认已启用「Web Browser (JCEF)」，然后重新加载插件。<br/>日志：Help → Show Log in Finder，搜索 CodeM。")
        }
        val content = ContentFactory.getInstance().createContent(component, "", false)
        toolWindow.contentManager.addContent(content)
    }

    private fun createBrowser(project: Project, parent: Disposable): JComponent {
        val tokens = IdeTheme.current()
        val uiRoot = UiBundle.materialize(javaClass.classLoader, tokens)
        if (uiRoot == null) {
            log.warn("CodeM UI bundle is missing")
            return fallbackPanel("CodeM 共享界面未打包。请先构建 @codem/ui，再重新安装插件。<br/>日志：Help → Show Log in Finder，搜索 CodeM。")
        }
        val panel = CodemBrowserPanel(project, uiRoot, pluginRoot(), tokens)
        Disposer.register(parent, panel)
        return panel
    }

    private fun pluginRoot(): Path? =
        PluginManagerCore.getPlugin(PluginId.getId("com.codem.intellij"))?.pluginPath

    private fun fallbackPanel(html: String): JComponent {
        val tokens = IdeTheme.current()
        val panel = JPanel(BorderLayout())
        panel.background = tokens.swingBackground
        panel.isOpaque = true
        val icon = IconLoader.getIcon("/icons/codem.svg", javaClass)
        val label = JLabel("<html>$html</html>", icon, SwingConstants.CENTER)
        label.foreground = tokens.swingForeground
        label.horizontalAlignment = SwingConstants.CENTER
        label.verticalTextPosition = SwingConstants.BOTTOM
        label.horizontalTextPosition = SwingConstants.CENTER
        panel.add(label, BorderLayout.CENTER)
        return panel
    }
}

class OpenCodemAction : com.intellij.openapi.actionSystem.AnAction() {
    override fun actionPerformed(event: com.intellij.openapi.actionSystem.AnActionEvent) {
        val project = event.project ?: return
        com.intellij.openapi.wm.ToolWindowManager.getInstance(project).getToolWindow("CodeM")?.activate(null)
    }
}

/**
 * 真实 JCEF 宿主：挂上共享 UI，首屏在浏览器脚本执行前就按 initialSnapshot 排队。
 */
class CodemBrowserPanel(
    project: Project,
    resourceRoot: Path,
    pluginRoot: Path?,
    tokens: IdeTheme.Tokens,
) : JPanel(BorderLayout()), Disposable {
    private lateinit var host: ToolWindowHost
    private val browser: JcefHostPanel

    init {
        background = tokens.swingBackground
        isOpaque = true
        // JCEF onLoadEnd 可能早于 host 赋值；未初始化时丢掉入站，避免 UninitializedPropertyAccess。
        browser = JcefHostPanel(resourceRoot, tokens) { action ->
            if (::host.isInitialized) host.handle(action)
        }
        // Host 构造时即排队首屏快照，发布由它的串行发布者独占。
        host = ToolWindowHost(project, browser, pluginRoot)
        add(browser, BorderLayout.CENTER)
    }

    override fun dispose() {
        host.dispose()
        browser.disposeBridge()
    }
}
