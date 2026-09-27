package com.codem.intellij.bootstrap

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager

/** 切换工作模式（Agent / Plan）：先显示 CodeM，再走输入栏同一条模式事务。 */
class CycleWorkModeAction : AnAction(), DumbAware {
    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        withChat(project) { it.cycleWorkMode() }
    }
}

/** 选择权限模式：显示 CodeM 并打开界面里的权限菜单；选择完全访问仍需在菜单中确认。 */
class SelectPermissionModeAction : AnAction(), DumbAware {
    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        withChat(project) { it.openPermissionMenu() }
    }
}

/** Shows the tool window with keyboard focus; its content, and so the host, exists once activation has run. */
internal fun withChat(project: Project, run: (ToolWindowHost) -> Unit) {
    val window = ToolWindowManager.getInstance(project).getToolWindow("CodeM") ?: return
    window.activate({ ToolWindowHost.of(project)?.let(run) }, true)
}
