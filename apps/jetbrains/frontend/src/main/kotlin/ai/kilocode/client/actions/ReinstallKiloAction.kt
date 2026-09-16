package ai.kilocode.client.actions

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware

class ReinstallKiloAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        service<KiloAppService>().reinstallAsync()
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = true
        if (e.place == KiloActionPlaces.connectionRetryPopup()) {
            e.presentation.text = KiloBundle.message("action.Kilo.Reinstall.cli.text")
        }
    }
}
