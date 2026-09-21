package com.codem.intellij.webview

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SynaraThemeTest {
    @Test
    fun mapsVscodeSynaraTokensNotIdeChrome() {
        val light = SynaraTheme.tokens(false)
        val dark = SynaraTheme.tokens(true)
        val lightCss = SynaraTheme.cssOverride(light)
        val darkCss = SynaraTheme.cssOverride(dark)
        assertTrue(light.surface == "#ffffff" && light.ink == "#0d0d0d")
        assertTrue(dark.surface == "#111111" && dark.ink == "#fcfcfc")
        assertTrue(light.primary == "#0d0d0d" && light.button == "#6554ee")
        assertTrue(lightCss.contains("--composerRadius: 19.2px"))
        assertTrue(lightCss.contains("--vscode-focusBorder: #0169cc"))
        assertTrue(lightCss.contains("--vscode-editor-background: #ffffff"))
        assertTrue(darkCss.contains("--primary: #fcfcfc"))
        assertTrue(darkCss.contains("--vscode-editor-background: #111111"))
        val laf = SynaraTheme.tokens(true, SynaraTheme.LafPaint("#2b2b2b", "#dcdcdc", "#3c3f41", "#dcdcdc", "#4c5052", "#dcdcdc", "#555555"))
        assertTrue(laf.surface == "#2b2b2b" && laf.editorBackground == "#2b2b2b")
        assertTrue(laf.button == "#6554ee")
        assertFalse(lightCss.contains("#efe6d8"))
        assertFalse(lightCss.contains("#f5c518"))
        val painted = SynaraTheme.paintIndex("<html><head></head><body></body></html>", light)
        assertTrue(painted.contains("codem-ide-theme"))
        assertTrue(painted.contains("codem-light"))
    }
}
