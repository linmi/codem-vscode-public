package com.codem.intellij.webview

import com.codem.intellij.core.CodemError
import com.codem.intellij.ide.PathGuard
import java.net.URI
import java.nio.file.Path

/**
 * 只加载打包资源。路径与 MIME 白名单，拒绝穿越。
 * 外部页面不能取得消息桥。
 */
object ResourcePolicy {
    private val mime = mapOf(
        "html" to "text/html; charset=utf-8",
        "js" to "text/javascript; charset=utf-8",
        "css" to "text/css; charset=utf-8",
        "svg" to "image/svg+xml",
        "png" to "image/png",
        "woff2" to "font/woff2",
        "json" to "application/json",
    )

    fun resolve(resourceRoot: Path, requestPath: String): Pair<Path, String> {
        val cleaned = requestPath.trim().ifBlank { "index.html" }.trimStart('/')
        if (cleaned.contains("..") || cleaned.startsWith("/") || cleaned.contains('\\')) {
            throw CodemError.Validation("CodeM UI resource path escaped its bundle")
        }
        val root = resourceRoot.toAbsolutePath().normalize()
        val target = root.resolve(cleaned).normalize()
        if (!target.startsWith(root)) throw CodemError.Validation("CodeM UI resource path escaped its bundle")
        val extension = cleaned.substringAfterLast('.', "")
        val type = mime[extension] ?: throw CodemError.Validation("CodeM UI resource type is not allowed")
        return target to type
    }

    /** 任意 file: 都拒绝；只有打包资源根内的 file URL、codem:// 与 about:blank 可导航。 */
    fun allowNavigation(url: String, resourceRoot: Path): Boolean {
        if (url == "about:blank" || url.startsWith("codem://")) return true
        if (!url.startsWith("file:")) return false
        return try {
            val uri = URI(url)
            if (uri.scheme != "file" || !uri.query.isNullOrEmpty() || !uri.fragment.isNullOrEmpty()) return false
            val candidate = try {
                Path.of(uri)
            } catch (_: Exception) {
                Path.of(uri.path)
            }
            PathGuard.bind(resourceRoot, candidate)
            true
        } catch (_: Exception) {
            false
        }
    }
}
