package com.codem.intellij.webview

import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.ui.JBColor
import com.intellij.util.ui.UIUtil
import java.awt.Color
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import javax.swing.UIManager
import kotlin.math.pow

/**
 * 从 IDEA LAF 读背景/前景/输入/按钮/边框，映射到 VS Code CSS 变量。
 * 深浅以实际编辑器/面板亮度判定，不信单一 JBColor.isBright。
 *
 * 更改要点：JCEF/Swing/html 同一底色；LAF 切换后由 Host 重注入。
 */
object IdeTheme {
    data class Tokens(
        val dark: Boolean,
        val htmlClass: String,
        val surface: String,
        val ink: String,
        val muted: String,
        val line: String,
        val popover: String,
        val soft: String,
        val accent: String,
        val button: String,
        val buttonInk: String,
        val buttonHover: String,
        val swingBackground: Color,
        val swingForeground: Color,
        val brandMark: String,
        val synara: SynaraTheme.Tokens,
    )

    fun current(): Tokens {
        val laf = readLaf()
        val synara = SynaraTheme.tokens(laf.dark, laf.paint)
        val swingBg = colorFromHex(synara.surface) ?: laf.background
        val swingFg = colorFromHex(synara.ink) ?: laf.foreground
        return Tokens(
            dark = synara.dark,
            htmlClass = synara.htmlClass,
            surface = synara.surface,
            ink = synara.ink,
            muted = synara.muted,
            line = synara.line,
            popover = synara.popover,
            soft = synara.soft,
            accent = synara.button,
            button = synara.button,
            buttonInk = synara.buttonInk,
            buttonHover = synara.buttonHover,
            swingBackground = swingBg,
            swingForeground = swingFg,
            brandMark = brandDataUri(),
            synara = synara,
        )
    }

    fun cssOverride(tokens: Tokens): String = SynaraTheme.cssOverride(tokens.synara)

    fun paintIndex(html: String, tokens: Tokens): String = SynaraTheme.paintIndex(html, tokens.synara)

    fun injectScript(tokens: Tokens): String = SynaraTheme.injectScript(tokens.synara)

    private data class LafRead(
        val dark: Boolean,
        val background: Color,
        val foreground: Color,
        val paint: SynaraTheme.LafPaint,
    )

    private fun readLaf(): LafRead {
        val editorScheme = runCatching { EditorColorsManager.getInstance().globalScheme }.getOrNull()
        val background = editorScheme?.defaultBackground
            ?: UIUtil.getPanelBackground()
            ?: UIManager.getColor("Panel.background")
            ?: if (JBColor.isBright()) Color.WHITE else Color(0x2B2B2B)
        val foreground = editorScheme?.defaultForeground
            ?: UIUtil.getLabelForeground()
            ?: UIManager.getColor("Label.foreground")
            ?: if (luminance(background) < 0.5) Color.WHITE else Color.BLACK
        val inputBackground = UIManager.getColor("TextField.background") ?: background
        val inputForeground = UIManager.getColor("TextField.foreground") ?: foreground
        val buttonBackground = UIManager.getColor("Button.default.startBackground")
            ?: UIManager.getColor("Button.default.background")
            ?: UIManager.getColor("Button.background")
            ?: background
        val buttonForeground = UIManager.getColor("Button.default.foreground")
            ?: UIManager.getColor("Button.foreground")
            ?: foreground
        val border = UIManager.getColor("Component.borderColor")
            ?: UIManager.getColor("Borders.color")
            ?: UIManager.getColor("Separator.separatorColor")
            ?: Color(foreground.red, foreground.green, foreground.blue, if (luminance(background) < 0.5) 40 else 28)
        val dark = luminance(background) < 0.5 || editorScheme?.let { runCatching { EditorColorsManager.getInstance().isDarkEditor }.getOrNull() } == true
        return LafRead(
            dark = dark,
            background = background,
            foreground = foreground,
            paint = SynaraTheme.LafPaint(
                background = hex(background),
                foreground = hex(foreground),
                inputBackground = hex(inputBackground),
                inputForeground = hex(inputForeground),
                buttonBackground = hex(buttonBackground),
                buttonForeground = hex(buttonForeground),
                border = hex(border),
            ),
        )
    }

    private fun luminance(color: Color): Double {
        fun channel(value: Int): Double {
            val srgb = value / 255.0
            return if (srgb <= 0.03928) srgb / 12.92 else ((srgb + 0.055) / 1.055).pow(2.4)
        }
        return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue)
    }

    private fun hex(color: Color): String = "#%02x%02x%02x".format(color.red, color.green, color.blue)

    private fun colorFromHex(value: String): Color? = runCatching { Color.decode(value) }.getOrNull()

    /** 登录页 logo：VS Code `assets/codemMark.svg`。 */
    private fun brandDataUri(): String {
        val svg = IdeTheme::class.java.getResourceAsStream("/icons/codemMark.svg")?.use { input ->
            input.readBytes().toString(StandardCharsets.UTF_8)
        } ?: return ""
        return "data:image/svg+xml,${URLEncoder.encode(svg, StandardCharsets.UTF_8).replace("+", "%20")}"
    }
}
