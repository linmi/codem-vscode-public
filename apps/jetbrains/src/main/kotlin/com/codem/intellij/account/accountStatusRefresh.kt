package com.codem.intellij.account

import com.codem.intellij.webview.AccountView

/** Owns one account status read. Completion and timeout race for the same attempt. */
class AccountStatusRefresh(
    private val current: () -> AccountView,
    private val publish: (AccountView) -> Unit,
) {
    private var nextId = 0L
    private var active: Long? = null
    private var closed = false

    /** Merge repeated reads; explicit refreshes never reuse a cached authentication result. */
    @Synchronized
    fun begin(): Long? {
        val account = current()
        if (closed || active != null || account.status == "signingIn") return null
        val id = ++nextId
        active = id
        publish(if (account.status == "signedIn") account.copy(refreshing = true, notice = null) else AccountView(status = "checking"))
        return id
    }

    /** The winner publishes and releases the read together; a late result cannot release a newer read. */
    @Synchronized
    fun finish(id: Long, account: AccountView): Boolean {
        if (closed || active != id) return false
        active = null
        publish(account)
        return true
    }

    /** Login/logout replace the account identity and revoke any outstanding status result. */
    @Synchronized
    fun replace(account: AccountView) {
        if (closed) return
        active = null
        publish(account)
    }

    @Synchronized
    fun close() {
        closed = true
        active = null
    }
}
