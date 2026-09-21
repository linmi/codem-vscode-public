package com.codem.intellij.webview

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * 侧栏必须是 IDEA template 单色 mark，不能把登录页彩色渐变或黑实心 512 图塞进 stripe。
 */
class ToolWindowIconTest {
    @Test
    fun stripeIconsAreMonochromeTemplates() {
        val light = read("icons/codem.svg")
        val expui = read("icons/expui/codem.svg")
        val dark = read("icons/codem_dark.svg")
        val mark = read("icons/codemMark.svg")
        assertTrue(light.contains("width=\"16\""))
        assertTrue(expui.contains("width=\"20\""))
        assertTrue(light.contains("fill=\"#000000\""))
        assertTrue(expui.contains("fill=\"#000000\""))
        assertTrue(dark.contains("fill=\"#AFB1B3\""))
        assertFalse(light.contains("#2B2D30") || light.contains("#6554ee") || light.contains("linearGradient"))
        assertFalse(expui.contains("linearGradient"))
        assertTrue(mark.contains("linearGradient"))
    }

    private fun read(path: String): String =
        javaClass.classLoader.getResourceAsStream(path)?.use { it.readBytes().toString(Charsets.UTF_8) }
            ?: throw AssertionError("missing $path")
}
