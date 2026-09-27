package com.codem.intellij.ide

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ToggleAction
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.openapi.wm.impl.status.widget.StatusBarWidgetsManager
import com.intellij.util.Consumer
import java.awt.Component
import java.awt.event.MouseEvent

/**
 * One inhibitor for the whole IDE, like VS Code's per extension host. Off after every IDE start and plugin reload;
 * disposing the service (IDE exit, plugin unload) ends the process.
 */
@Service(Service.Level.APP)
class KeepAwakeService : Disposable {
    private val log = Logger.getInstance(KeepAwakeService::class.java)
    private val keepAwake = KeepAwake(
        command = Inhibitors.command(System.getProperty("os.name"), ProcessHandle.current().pid()),
        publish = { log.info("CodeM keep awake: ${if (on) "on" else "off"}"); refreshWidgets() },
        failed = { message ->
            log.warn("CodeM keep awake: $message")
            NotificationGroupManager.getInstance().getNotificationGroup("CodeM").createNotification(message, NotificationType.ERROR).notify(null)
        },
    )

    val on: Boolean get() = keepAwake.on

    fun toggle() = keepAwake.toggle()

    override fun dispose() = keepAwake.dispose()

    /** The widget is shown only while keep-awake is on, so the first frame and every restart show nothing. */
    private fun refreshWidgets() {
        ApplicationManager.getApplication().invokeLater {
            for (project in ProjectManager.getInstance().openProjects) {
                if (!project.isDisposed) project.service<StatusBarWidgetsManager>().updateWidget(KeepAwakeWidgetFactory::class.java)
            }
        }
    }

    companion object {
        fun get(): KeepAwakeService = service()
    }
}

/** CodeM：切换防休眠。菜单里的勾选即当前状态。 */
class ToggleKeepAwakeAction : ToggleAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT
    override fun isSelected(event: AnActionEvent): Boolean = KeepAwakeService.get().on
    override fun setSelected(event: AnActionEvent, state: Boolean) {
        if (state != KeepAwakeService.get().on) KeepAwakeService.get().toggle()
    }
}

class KeepAwakeWidgetFactory : StatusBarWidgetFactory {
    override fun getId(): String = WIDGET_ID
    override fun getDisplayName(): String = "CodeM 防休眠"
    override fun isAvailable(project: Project): Boolean = KeepAwakeService.get().on
    override fun createWidget(project: Project): StatusBarWidget = KeepAwakeWidget()
    override fun canBeEnabledOn(statusBar: StatusBar): Boolean = true

    companion object {
        const val WIDGET_ID = "codem.keepAwake"
    }
}

/** Clicking the widget turns keep-awake off. */
private class KeepAwakeWidget : StatusBarWidget, StatusBarWidget.TextPresentation {
    override fun ID(): String = KeepAwakeWidgetFactory.WIDGET_ID
    override fun getPresentation(): StatusBarWidget.WidgetPresentation = this
    override fun getText(): String = "防休眠"
    override fun getAlignment(): Float = Component.CENTER_ALIGNMENT
    override fun getTooltipText(): String = "CodeM 正在阻止系统空闲休眠，点击关闭"
    override fun getClickConsumer(): Consumer<MouseEvent> = Consumer { KeepAwakeService.get().toggle() }
    override fun install(statusBar: StatusBar) = Unit
    override fun dispose() = Unit
}
