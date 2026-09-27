package com.codem.intellij.session

import com.codem.intellij.webview.AccountView
import com.codem.intellij.webview.encodeChatSnapshot
import com.codem.intellij.webview.initialSnapshot
import com.codem.intellij.core.JsonValue
import com.codem.intellij.core.required
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ModeCommandsTest {
    @Test
    fun workModeCyclesBetweenAgentAndPlan() {
        assertEquals("plan", ModeCommands.nextWorkMode("default"))
        assertEquals("default", ModeCommands.nextWorkMode("plan"))
        assertEquals("plan", ModeCommands.nextWorkMode("unknown"), "An unknown mode starts from Agent")
    }

    @Test
    fun onlyAnIdleSignedInChatChangesModes() {
        val signedIn = initialSnapshot().copy(account = AccountView(status = "signedIn"))
        assertTrue(ModeCommands.canChangeModes(signedIn.copy(phase = "ready")))
        for (phase in listOf("disconnected", "connecting", "sending", "running", "stopping", "failed")) {
            assertFalse(ModeCommands.canChangeModes(signedIn.copy(phase = phase)), phase)
        }
        assertFalse(ModeCommands.canChangeModes(initialSnapshot().copy(phase = "ready", account = AccountView(status = "signedOut"))))
    }

    @Test
    fun thePermissionMenuRequestReachesThePage() {
        assertEquals(JsonValue.NumberValue(0.0, "0"), encodeChatSnapshot(initialSnapshot()).required("permissionMenuRequest"))
        val encoded = encodeChatSnapshot(initialSnapshot().copy(permissionMenuRequest = 3))
        assertEquals(JsonValue.NumberValue(3.0, "3"), encoded.required("permissionMenuRequest"))
    }
}
