package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.worktree.WorktreeDataKeys
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.DumbAware
import java.awt.datatransfer.StringSelection

/** Copies the absolute path of the worktree the branch is checked out in. */
class CopyBranchPathAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.getData(WorktreeDataKeys.WORKTREE) != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val item = e.getData(WorktreeDataKeys.WORKTREE) ?: return
        CopyPasteManager.getInstance().setContents(StringSelection(item.path))
    }
}
