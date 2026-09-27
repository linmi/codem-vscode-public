package com.codem.intellij.session

import com.codem.intellij.webview.ChatSnapshot

/**
 * The work mode and permission mode commands reuse the composer's own paths: the work mode goes through the session's
 * mode transaction, and the permission command only asks the page to open its menu, so choosing full access still asks
 * for confirmation there.
 */
object ModeCommands {
    private val workModes = listOf("default", "plan")

    /** Agent → Plan → Agent. An unknown mode starts the cycle from Agent. */
    fun nextWorkMode(current: String): String =
        workModes[(workModes.indexOf(current).coerceAtLeast(0) + 1) % workModes.size]

    /** Like the composer menu: only an idle, connected, signed-in chat changes modes; busy phases ignore the command. */
    fun canChangeModes(snapshot: ChatSnapshot): Boolean =
        snapshot.phase == "ready" && snapshot.account.status == "signedIn"
}
