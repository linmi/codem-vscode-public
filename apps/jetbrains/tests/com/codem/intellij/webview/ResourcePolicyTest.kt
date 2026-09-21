package com.codem.intellij.webview

import com.codem.intellij.core.CodemError
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

class ResourcePolicyTest {
    @Test
    fun rejectsTraversalAndUnknownTypes(@TempDir root: Path) {
        val (path, mime) = ResourcePolicy.resolve(root, "index.html")
        assertEquals("text/html; charset=utf-8", mime)
        assertTrue(path.startsWith(root))
        var failed = false
        try {
            ResourcePolicy.resolve(root, "../secret.html")
        } catch (_: CodemError) {
            failed = true
        }
        assertTrue(failed)
        failed = false
        try {
            ResourcePolicy.resolve(root, "payload.exe")
        } catch (_: CodemError) {
            failed = true
        }
        assertTrue(failed)
        assertTrue(!ResourcePolicy.allowNavigation("https://example.com", root))
        assertTrue(!ResourcePolicy.allowNavigation("file:///etc/passwd", root))
        val allowed = ResourcePolicy.resolve(root, "index.html").first.toUri().toString()
        assertTrue(ResourcePolicy.allowNavigation(allowed, root))
        assertTrue(ResourcePolicy.allowNavigation("about:blank", root))
    }
}
