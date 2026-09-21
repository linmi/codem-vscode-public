package com.codem.intellij.account

import com.codem.intellij.webview.AccountProfileView
import com.codem.intellij.webview.AccountView

/**
 * 与 VS Code AccountController 对齐的账户投影。
 * 点登录必须立刻 signingIn；失败 error；取消 signedOut。不持有密钥或路径。
 */
object AccountProjection {
    fun signedOut(notice: String? = null): AccountView = AccountView(status = "signedOut", notice = notice)

    fun signingIn(progress: String = "opening"): AccountView = AccountView(status = "signingIn", progress = progress)

    fun cancelling(): AccountView = signingIn("cancelling")

    fun cancelled(): AccountView = signedOut("已取消登录，可随时重试。")

    fun error(message: String): AccountView = AccountView(status = "error", message = message)

    fun fromLoginProgress(progress: LoginProgress): AccountView = when (progress) {
        LoginProgress.AuthorizationReady -> signingIn("waiting")
        LoginProgress.Binding, LoginProgress.Authenticated -> signingIn("binding")
    }

    fun signedIn(status: AuthStatus, notice: String? = null): AccountView = AccountView(
        status = "signedIn",
        notice = notice,
        refreshing = false,
        profile = AccountProfileView(
            displayName = status.displayName,
            userId = status.userId,
            tenantId = status.tenantId,
            authMethod = status.authMethod,
            avatarKind = "none",
        ),
    )

    /** 与 VS Code apply() 一致：必须 loggedIn 且 routerCredential 才能进聊天壳。 */
    fun fromStatus(status: AuthStatus): AccountView =
        if (status.loggedIn && status.routerCredential == true) {
            signedIn(status)
        } else {
            signedOut(if (status.loggedIn) "登录已失效，请重新登录。" else null)
        }
}
