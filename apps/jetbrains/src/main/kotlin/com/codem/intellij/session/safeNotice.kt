package com.codem.intellij.session

import com.codem.intellij.core.CodemError

/**
 * 界面 notice 不得携带路径、协议帧或密钥。
 * 只有产品可展示的 CodeM Validation/Conflict/Authentication/Cancelled 原文可以通过，其余落回 fallback。
 */
object SafeNotice {
    private val secret = Regex("(?i)(token|password|api[_-]?key|authorization|secret|bearer|sk-[A-Za-z0-9])")
    private val unixPath = Regex("""(?<![A-Za-z0-9])/(?:Users|home|tmp|var|etc|opt|private|Volumes|root)/[^\s"'\\]+""")
    private val windowsPath = Regex("""(?i)(?:[A-Z]:[\\/]|\\\\)[^\s"']+""")
    private val fileUrl = Regex("""(?i)file:/[^\s"']+""")
    private val frame = Regex("""(?i)jsonrpc|Content-Length|item/[A-Za-z]+/|turn/start|thread/start""")

    private val safeClasses = setOf(
        CodemError.Class.Validation,
        CodemError.Class.Conflict,
        CodemError.Class.Authentication,
        CodemError.Class.Cancelled,
    )

    fun from(error: Throwable, fallback: String): String {
        val raw = error.message?.trim().orEmpty()
        if (raw.isEmpty() || containsSensitive(raw)) return fallback
        val classified = error as? CodemError ?: return fallback
        if (classified.errorClass !in safeClasses) return fallback
        return if (raw.startsWith("CodeM ")) raw else fallback
    }

    fun containsSensitive(text: String): Boolean =
        secret.containsMatchIn(text) ||
            unixPath.containsMatchIn(text) ||
            windowsPath.containsMatchIn(text) ||
            fileUrl.containsMatchIn(text) ||
            frame.containsMatchIn(text)
}
