package com.codem.intellij.webview

/**
 * VS Code 现网 synaraTokens + IDEA LAF 覆盖。
 * 产品几何/登录紫不变；背景、文字、输入、按钮、边框跟 IDE。
 *
 * 更改要点：深色 IDEA 不再落到 html 默认白；--vscode-editor-background 等由 LAF 注入。
 */
object SynaraTheme {
    data class LafPaint(
        val background: String,
        val foreground: String,
        val inputBackground: String,
        val inputForeground: String,
        val buttonBackground: String,
        val buttonForeground: String,
        val border: String,
    )

    data class Tokens(
        val dark: Boolean,
        val htmlClass: String,
        val surface: String,
        val ink: String,
        val muted: String,
        val tertiary: String,
        val line: String,
        val heavyLine: String,
        val soft: String,
        val hover: String,
        val popover: String,
        val primary: String,
        val onPrimary: String,
        val codeSurface: String,
        val button: String,
        val buttonInk: String,
        val buttonHover: String,
        val focus: String,
        val composerShadow: String,
        val surfaceBorder: String,
        val editorBackground: String,
        val editorForeground: String,
        val inputBackground: String,
        val inputForeground: String,
        val inputBorder: String,
        val vscodeButtonBackground: String,
        val vscodeButtonForeground: String,
    )

    fun tokens(dark: Boolean, laf: LafPaint? = null): Tokens {
        val base = if (dark) darkTokens() else lightTokens()
        if (laf == null) return base
        val ink = laf.foreground
        val surface = laf.background
        return base.copy(
            surface = surface,
            ink = ink,
            muted = if (dark) "rgba(252, 252, 252, 0.58)" else "rgba(13, 13, 13, 0.598)",
            tertiary = if (dark) "rgba(252, 252, 252, 0.329)" else "rgba(13, 13, 13, 0.398)",
            line = laf.border,
            heavyLine = laf.border,
            popover = laf.inputBackground,
            primary = ink,
            onPrimary = surface,
            editorBackground = laf.background,
            editorForeground = laf.foreground,
            inputBackground = laf.inputBackground,
            inputForeground = laf.inputForeground,
            inputBorder = laf.border,
            vscodeButtonBackground = laf.buttonBackground,
            vscodeButtonForeground = laf.buttonForeground,
        )
    }

    private fun darkTokens(): Tokens =
        Tokens(
            dark = true,
            htmlClass = "vscode-dark codem-dark",
            surface = "#111111",
            ink = "#fcfcfc",
            muted = "rgba(252, 252, 252, 0.58)",
            tertiary = "rgba(252, 252, 252, 0.329)",
            line = "rgba(252, 252, 252, 0.072)",
            heavyLine = "rgba(252, 252, 252, 0.118)",
            soft = "rgba(252, 252, 252, 0.026)",
            hover = "rgba(252, 252, 252, 0.039)",
            popover = "rgb(23, 23, 23)",
            primary = "#fcfcfc",
            onPrimary = "#111111",
            codeSurface = "rgba(252, 252, 252, 0.026)",
            button = "#6554ee",
            buttonInk = "#ffffff",
            buttonHover = "#5546d3",
            focus = "#0169cc",
            composerShadow = "0 6px 24px -10px rgba(0, 0, 0, .30)",
            surfaceBorder = "color-mix(in srgb, rgba(252, 252, 252, 0.072) 55%, transparent)",
            editorBackground = "#111111",
            editorForeground = "#fcfcfc",
            inputBackground = "#1b1b1b",
            inputForeground = "#fcfcfc",
            inputBorder = "rgba(252, 252, 252, 0.118)",
            vscodeButtonBackground = "#6554ee",
            vscodeButtonForeground = "#ffffff",
        )

    private fun lightTokens(): Tokens =
        Tokens(
            dark = false,
            htmlClass = "codem-light",
            surface = "#ffffff",
            ink = "#0d0d0d",
            muted = "rgba(13, 13, 13, 0.598)",
            tertiary = "rgba(13, 13, 13, 0.398)",
            line = "rgba(13, 13, 13, 0.069)",
            heavyLine = "rgba(13, 13, 13, 0.059)",
            soft = "rgba(13, 13, 13, 0.03)",
            hover = "rgba(13, 13, 13, 0.03)",
            popover = "rgb(255, 255, 255)",
            primary = "#0d0d0d",
            onPrimary = "#ffffff",
            codeSurface = "rgba(13, 13, 13, 0.03)",
            button = "#6554ee",
            buttonInk = "#ffffff",
            buttonHover = "#5546d3",
            focus = "#0169cc",
            composerShadow = "0 4px 18px -6px color-mix(in srgb, #0d0d0d 7%, transparent)",
            surfaceBorder = "color-mix(in srgb, color-mix(in srgb, rgba(13, 13, 13, 0.059) 95%, #0d0d0d 5%) 55%, transparent)",
            editorBackground = "#ffffff",
            editorForeground = "#0d0d0d",
            inputBackground = "#ffffff",
            inputForeground = "#0d0d0d",
            inputBorder = "rgba(13, 13, 13, 0.069)",
            vscodeButtonBackground = "#6554ee",
            vscodeButtonForeground = "#ffffff",
        )

    fun cssVariables(tokens: Tokens): String =
        """
        --surface: ${tokens.surface};
        --ink: ${tokens.ink};
        --muted: ${tokens.muted};
        --tertiary: ${tokens.tertiary};
        --line: ${tokens.line};
        --heavyLine: ${tokens.heavyLine};
        --soft: ${tokens.soft};
        --hover: ${tokens.hover};
        --popover: ${tokens.popover};
        --primary: ${tokens.primary};
        --onPrimary: ${tokens.onPrimary};
        --codeSurface: ${tokens.codeSurface};
        --accent: ${tokens.button};
        --button: ${tokens.button};
        --buttonInk: ${tokens.buttonInk};
        --buttonHover: ${tokens.buttonHover};
        --focus: ${tokens.focus};
        --composerShadow: ${tokens.composerShadow};
        --surfaceBorder: ${tokens.surfaceBorder};
        --chatWidth: 736px;
        --composerRadius: 19.2px;
        --bubbleRadius: 16px;
        --chatFont: 14px;
        --uiFontSize: 13px;
        --detailFontSize: 12px;
        --captionFontSize: 11px;
        --codeFontSize: 12px;
        --chatLeading: 1.625;
        --vscode-editor-background: ${tokens.editorBackground};
        --vscode-editor-foreground: ${tokens.editorForeground};
        --vscode-foreground: ${tokens.editorForeground};
        --vscode-sideBar-background: ${tokens.editorBackground};
        --vscode-panel-background: ${tokens.editorBackground};
        --vscode-panel-border: ${tokens.inputBorder};
        --vscode-input-background: ${tokens.inputBackground};
        --vscode-input-foreground: ${tokens.inputForeground};
        --vscode-input-border: ${tokens.inputBorder};
        --vscode-focusBorder: ${tokens.focus};
        --vscode-button-background: ${tokens.vscodeButtonBackground};
        --vscode-button-foreground: ${tokens.vscodeButtonForeground};
        --vscode-button-hoverBackground: ${tokens.buttonHover};
        --vscode-errorForeground: #c63737;
        --vscode-charts-green: #16833e;
        --vscode-descriptionForeground: ${tokens.muted};
        --vscode-toolbar-hoverBackground: ${tokens.hover};
        --vscode-editorWarning-foreground: #e47140;
        --color-primary: ${tokens.primary};
        --color-primary-foreground: ${tokens.onPrimary};
        """.trimIndent()

    fun cssOverride(tokens: Tokens): String =
        """
        :root, html, body, #codem-root {
          background: ${tokens.surface} !important;
          color: ${tokens.ink} !important;
          color-scheme: ${if (tokens.dark) "dark" else "light"};
          ${cssVariables(tokens).replace("\n", "\n          ")}
        }
        """.trimIndent()

    fun injectScript(tokens: Tokens): String {
        val other = if (tokens.dark) "codem-light" else "vscode-dark"
        val vars = listOf(
            "surface" to tokens.surface,
            "ink" to tokens.ink,
            "muted" to tokens.muted,
            "tertiary" to tokens.tertiary,
            "line" to tokens.line,
            "heavyLine" to tokens.heavyLine,
            "soft" to tokens.soft,
            "hover" to tokens.hover,
            "popover" to tokens.popover,
            "primary" to tokens.primary,
            "onPrimary" to tokens.onPrimary,
            "codeSurface" to tokens.codeSurface,
            "accent" to tokens.button,
            "button" to tokens.button,
            "buttonInk" to tokens.buttonInk,
            "buttonHover" to tokens.buttonHover,
            "focus" to tokens.focus,
            "vscode-editor-background" to tokens.editorBackground,
            "vscode-editor-foreground" to tokens.editorForeground,
            "vscode-foreground" to tokens.editorForeground,
            "vscode-sideBar-background" to tokens.editorBackground,
            "vscode-panel-background" to tokens.editorBackground,
            "vscode-panel-border" to tokens.inputBorder,
            "vscode-input-background" to tokens.inputBackground,
            "vscode-input-foreground" to tokens.inputForeground,
            "vscode-input-border" to tokens.inputBorder,
            "vscode-focusBorder" to tokens.focus,
            "vscode-button-background" to tokens.vscodeButtonBackground,
            "vscode-button-foreground" to tokens.vscodeButtonForeground,
            "vscode-button-hoverBackground" to tokens.buttonHover,
        ).joinToString("\n") { (name, value) ->
            "            root.style.setProperty('--$name', '$value');"
        }
        return """
            document.documentElement.className = '${tokens.htmlClass}';
            document.documentElement.classList.remove('$other');
            document.documentElement.style.colorScheme = '${if (tokens.dark) "dark" else "light"}';
            if (document.body) {
              document.body.className = '${tokens.htmlClass}';
              document.body.classList.remove('$other');
            }
            var root = document.documentElement;
$vars
            document.documentElement.style.background = '${tokens.surface}';
            document.documentElement.style.color = '${tokens.ink}';
            if (document.body) {
              document.body.style.background = '${tokens.surface}';
              document.body.style.color = '${tokens.ink}';
            }
            var host = document.getElementById('codem-root');
            if (host) {
              host.style.background = '${tokens.surface}';
              host.style.color = '${tokens.ink}';
            }
        """.trimIndent()
    }

    fun paintIndex(html: String, tokens: Tokens): String {
        val withClass = html.replaceFirst(
            Regex("<html\\b([^>]*)>"),
            """<html$1 class="${tokens.htmlClass}" style="background:${tokens.surface};color:${tokens.ink};color-scheme:${if (tokens.dark) "dark" else "light"}">""",
        )
        val style = """<style id="codem-ide-theme">${cssOverride(tokens)}</style>"""
        return if (withClass.contains("</head>")) {
            withClass.replace("</head>", "$style</head>")
        } else {
            withClass
        }
    }
}
