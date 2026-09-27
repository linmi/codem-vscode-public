package com.codem.intellij.ide

import com.intellij.openapi.project.Project
import org.jetbrains.plugins.terminal.TerminalToolWindowManager

/**
 * Writes one line at the prompt of the selected terminal tab, or of a new "CodeM" tab when none is open, without a
 * newline: the person presses Enter. Loaded only when the bundled terminal plugin is enabled (codem-terminal.xml).
 */
object TerminalInsertion {
    fun insert(project: Project, line: String) {
        val manager = TerminalToolWindowManager.getInstance(project)
        val selected = manager.toolWindow?.contentManager?.selectedContent
        val widget = selected?.let { TerminalToolWindowManager.findWidgetByContent(it) }
            ?: manager.createShellWidget(project.basePath, "CodeM", true, true)
        manager.toolWindow?.activate(null)
        // Runs once the shell's tty is connected, also for a tab created just now.
        widget.ttyConnectorAccessor.executeWithTtyConnector { connector -> connector.write(line) }
    }
}
