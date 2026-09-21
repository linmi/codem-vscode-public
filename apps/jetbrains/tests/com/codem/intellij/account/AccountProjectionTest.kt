package com.codem.intellij.account

import com.codem.intellij.core.JsonValue
import com.codem.intellij.webview.encodeChatSnapshot
import com.codem.intellij.webview.initialSnapshot
import com.codem.intellij.webview.parseViewAction
import com.codem.intellij.webview.ViewAction
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AccountProjectionTest {
    @Test
    fun signInActionParsesAndOpeningIsVisible() {
        assertTrue(parseViewAction(JsonValue.obj("type" to JsonValue.Text("signIn"))) === ViewAction.SignIn)
        val opening = AccountProjection.signingIn()
        assertEquals("signingIn", opening.status)
        assertEquals("opening", opening.progress)
    }

    @Test
    fun loginProgressMatchesVsCodeStages() {
        assertEquals("waiting", AccountProjection.fromLoginProgress(LoginProgress.AuthorizationReady).progress)
        assertEquals("binding", AccountProjection.fromLoginProgress(LoginProgress.Binding).progress)
        assertEquals("cancelling", AccountProjection.cancelling().progress)
        assertEquals("signedOut", AccountProjection.cancelled().status)
        assertEquals("error", AccountProjection.error("登录未完成，请重试。").status)
        assertEquals("读取登录状态超时，请重试。", AccountProjection.error(com.codem.intellij.session.HostLoadingFeedback.ACCOUNT_TIMEOUT).message)
    }

    @Test
    fun routerCredentialRequiredForSignedIn() {
        val ready = AuthStatus(true, "oauth", true, "https://example.test", "tenant", "user", "Ada")
        assertEquals("signedIn", AccountProjection.fromStatus(ready).status)
        assertEquals("Ada", AccountProjection.fromStatus(ready).profile?.displayName)
        assertEquals("signedOut", AccountProjection.fromStatus(ready.copy(routerCredential = false)).status)
    }

    @Test
    fun encodedSnapshotKeepsSigningInProgress() {
        val snapshot = initialSnapshot().copy(account = AccountProjection.signingIn("waiting"))
        val account = encodeChatSnapshot(snapshot).fields["account"] as JsonValue.ObjectValue
        assertEquals("signingIn", (account.fields["status"] as JsonValue.Text).value)
        assertEquals("waiting", (account.fields["progress"] as JsonValue.Text).value)
    }
}
