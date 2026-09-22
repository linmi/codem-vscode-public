package com.codem.intellij.session

/**
 * Host 拥有检查/连接超时与可读文案。界面只渲染这些字符串，不自己猜阶段。
 *
 * 更改要点：checking/connecting 超过短超时必须落到失败+重试，不能只剩 Logo。
 */
object HostLoadingFeedback {
    const val ACCOUNT_MS = 8_000L
    const val CONNECT_MS = 12_000L
    const val CHECKING = "正在检查登录状态"
    const val CHECKING_DETAIL = "正在读取本机登录信息…"
    const val ACCOUNT_TIMEOUT = "读取登录状态超时，请重试。"
    const val ACCOUNT_FAILED = "暂时无法读取登录状态，请重试。"
    const val CONNECTING = "正在连接 CodeM…"
    const val CONNECT_TIMEOUT = "连接超时，请重试。"

    fun connectStillPending(phase: String): Boolean = phase == "connecting"
}
