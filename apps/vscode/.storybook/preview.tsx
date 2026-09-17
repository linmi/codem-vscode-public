/** @jsxImportSource solid-js */
import type { Preview, SolidRenderer } from "storybook-solidjs-vite"
import type { DecoratorFunction } from "storybook/internal/types"
// Theme helpers live in @codem/ui stories; they are not package exports.
import { applyDesktopTheme, applyVscodeTheme, clearVscodeTheme } from "../../../packages/ui/src/stories/theme-decorator"
import "../../../packages/ui/.storybook/fonts.css"
import "@codem/ui/styles"
import "../webview-ui/src/styles/chat.css"

// Make the Kilo logo available in Storybook (normally injected by the extension host)
;(window as { ICONS_BASE_URI?: string }).ICONS_BASE_URI = "/icons"

const themeDecorator: DecoratorFunction<SolidRenderer> = (Story, context) => {
  const themeId = (context.globals["theme"] as string) ?? "codem-vscode"
  const vscodeThemeId = (context.globals["vscodeTheme"] as string) ?? "dark-modern"

  const colorScheme = (() => {
    if (themeId === "codem-vscode") return applyVscodeTheme(vscodeThemeId)
    clearVscodeTheme()
    return (context.globals["colorScheme"] as "light" | "dark") ?? "dark"
  })()

  applyDesktopTheme(themeId, colorScheme)
  document.body.style.background = "var(--background-base)"
  document.body.style.color = "var(--text-base)"
  return Story()
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: "fullscreen",
  },
  decorators: [themeDecorator],
  globalTypes: {
    theme: {
      description: "Theme",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        items: [
          { value: "codem-vscode", title: "CodeM VS Code" },
          { value: "codem", title: "CodeM" },
        ],
        dynamicTitle: true,
      },
    },
    colorScheme: {
      description: "Color Scheme",
      toolbar: {
        title: "Color Scheme",
        icon: "circlehollow",
        items: [
          { value: "dark", title: "Dark", icon: "moon" },
          { value: "light", title: "Light", icon: "sun" },
        ],
        dynamicTitle: true,
      },
    },
    vscodeTheme: {
      description: "VSCode Theme",
      toolbar: {
        title: "VSCode Theme",
        icon: "browser",
        items: [
          { value: "dark-modern", title: "Dark Modern (default)" },
          { value: "dark-plus", title: "Dark+" },
          { value: "light-modern", title: "Light Modern" },
          { value: "hc-black", title: "High Contrast Dark" },
          { value: "hc-light", title: "High Contrast Light" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "codem-vscode",
    colorScheme: "dark",
    vscodeTheme: "dark-modern",
    a11y: { manual: true },
  },
}

export default preview
