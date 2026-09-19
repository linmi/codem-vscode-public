/**
 * Architecture tests: Agent Manager
 *
 * The agent manager runs in the same webview context as other UI.
 * All its CSS classes must be prefixed with "am-" to avoid conflicts.
 * These tests also verify consistency between CSS definitions and TSX usage,
 * and that leftover Host worktree/Kilo orchestration stays deleted.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { Project, SyntaxKind } from "ts-morph"

const ROOT = path.resolve(import.meta.dir, "../..")
const KILO_PROVIDER_FILE = path.join(ROOT, "src/CodeMProvider.ts")
const EDIT_PREVIEW_PANEL_FILE = path.join(ROOT, "webview-ui/agent-manager/EditPreviewPanel.tsx")
const CSS_FILES = [
  path.join(ROOT, "webview-ui/agent-manager/agent-manager.css"),
  path.join(ROOT, "webview-ui/agent-manager/agent-manager-review.css"),
  path.join(ROOT, "webview-ui/agent-manager/intro/intro.css"),
  path.join(ROOT, "webview-ui/browser/browser.css"),
]
const TSX_FILES = [
  path.join(ROOT, "webview-ui/agent-manager/AgentManagerApp.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/ShortcutsDialog.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/intro/AgentManagerIntro.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/intro/IntroGraph.tsx"),
  path.join(ROOT, "webview-ui/src/components/chat/MessageList.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/SubagentPanel.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/EditPreviewPanel.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/SessionRowActions.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/NewWorktreeDialog.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/ProjectSelect.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/sortable-tab.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/DiffPanel.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/BrowserPanel.tsx"),
  path.join(ROOT, "webview-ui/browser/BrowserPanel.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/DiffPanelCache.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/review-composers.ts"),
  path.join(ROOT, "webview-ui/documents/DocumentPanel.tsx"),
  path.join(ROOT, "webview-ui/diff-viewer/FullScreenDiffView.tsx"),
  path.join(ROOT, "webview-ui/diff-viewer/ReviewDiffItem.tsx"),
  path.join(ROOT, "webview-ui/diff-viewer/ImageDiffView.tsx"),
  path.join(ROOT, "webview-ui/diff-viewer/MarkdownDiffView.tsx"),
  path.join(ROOT, "webview-ui/diff-viewer/VirtualDiffView.tsx"),
  path.join(ROOT, "webview-ui/diff-viewer/MarkdownAnnotationLayer.tsx"),
  path.join(ROOT, "webview-ui/diff-viewer/markdown-comment-ranges.ts"),
  path.join(ROOT, "webview-ui/diff-viewer/DiffEndMarker.tsx"),
  path.join(ROOT, "webview-ui/diff-viewer/FileTree.tsx"),
  path.join(ROOT, "webview-ui/diff-viewer/review-annotations.ts"),
  path.join(ROOT, "webview-ui/agent-manager/MultiModelSelector.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/ApplyDialog.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/WorktreeItem.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/pr/PRBadge.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/SectionHeader.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/SidebarSectionHeader.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/SidebarSearchMenu.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/SidebarToggleButton.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/WorktreeSectionActions.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/ProjectsSection.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/ProjectSidebarBody.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/ProjectList.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/ProjectActions.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/SidebarBody.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/Skeleton.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/TabBar.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/ClosableTab.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/InspectorTabStrip.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/ProjectBranchDialog.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/tab-rendering.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/terminal/TerminalTab.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/terminal/SideTerminalPanel.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/terminal/TerminalDestinationButton.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/terminal/SortableTerminalTab.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/terminal/render.tsx"),
  path.join(ROOT, "webview-ui/diff-virtual/DiffVirtualApp.tsx"),
  // Shared components that consume agent-manager CSS classes (e.g. am-dropdown,
  // am-branch-item) used by both the agent manager and the diff viewer.
  path.join(ROOT, "webview-ui/src/components/shared/ActivityIcon.tsx"),
  path.join(ROOT, "webview-ui/src/components/shared/BranchSelect.tsx"),
  path.join(ROOT, "webview-ui/src/components/chat/TabDnd.tsx"),
  path.join(ROOT, "webview-ui/diff-viewer/BaseBranchPicker.tsx"),
]
const SHARED_CSS = path.join(ROOT, "webview-ui/src/styles/session-tabs.css")
const TSX_FILE = TSX_FILES[0]!
const KEYBIND_DEFAULTS_FILE = path.join(ROOT, "webview-ui/agent-manager/keybind-defaults.ts")
const PROVIDER_FILE = path.join(ROOT, "src/agent-manager/AgentManagerProvider.ts")

function readAllCss(): string {
  return CSS_FILES.map((f) => fs.readFileSync(f, "utf-8")).join("\n")
}

function readAllTsx(): string {
  return TSX_FILES.map((f) => fs.readFileSync(f, "utf-8")).join("\n")
}

describe("Agent Manager CSS Prefix", () => {
  it("all class selectors should use am- prefix", () => {
    const css = readAllCss()
    const matches = [...css.matchAll(/\.([a-z][a-z0-9-]*)/gi)]
    const names = [...new Set(matches.map((m) => m[1]))]

    // Exceptions:
    // - VS Code sets these body classes on webview elements (scoping
    //   selectors for high contrast theme support).
    // - `diff-theme` is the shared Pierre diff theme utility defined
    //   in webview-ui/src/styles/diff.css and reused across webviews.
    // - `css` is matched from `@import "./diff.css"` file extension, not a
    //   class selector.
    const host = new Set(["vscode-high-contrast", "vscode-high-contrast-light", "diff-theme", "css"])
    const invalid = names.filter((n) => !n!.startsWith("am-") && !host.has(n!))

    expect(invalid, `Classes missing "am-" prefix: ${invalid.join(", ")}`).toEqual([])
  })

  it("all CSS custom properties should use am- prefix", () => {
    const css = readAllCss()
    const matches = [...css.matchAll(/--([a-z][a-z0-9-]*)\s*:/gi)]
    const names = [...new Set(matches.map((m) => m[1]))]

    // Allow @codem/ui design tokens, vscode theme variables, and third-party
    // library tokens (@pierre/diffs, @codem/ui sticky-accordion) used as fallbacks
    const allowed = ["am-", "vscode-", "surface-", "text-", "border-", "diffs-", "sticky-", "syntax-"]
    const invalid = names.filter((n) => !allowed.some((p) => n!.startsWith(p)))

    expect(invalid, `CSS properties missing allowed prefix: ${invalid.join(", ")}`).toEqual([])
  })

  it("all @keyframes should use am- prefix", () => {
    const css = readAllCss()
    const matches = [...css.matchAll(/@keyframes\s+([a-z][a-z0-9-]*)/gi)]
    const names = matches.map((m) => m[1])

    const invalid = names.filter((n) => !n!.startsWith("am-"))

    expect(invalid, `Keyframes missing "am-" prefix: ${invalid.join(", ")}`).toEqual([])
  })
})

describe("Agent Manager CSS/TSX Consistency", () => {
  it("all classes used in TSX should be defined in CSS", () => {
    const css = readAllCss() + fs.readFileSync(SHARED_CSS, "utf-8")
    const tsx = readAllTsx()

    // Extract am- classes defined in CSS
    const cssMatches = [...css.matchAll(/\.([a-z][a-z0-9-]*)/gi)]
    const defined = new Set(cssMatches.map((m) => m[1]))

    // Extract am- classes referenced in TSX (class="am-..." or `am-...`)
    const tsxMatches = [...tsx.matchAll(/\bam-[a-z0-9-]+/g)]
    const used = [...new Set(tsxMatches.map((m) => m[0]))]

    const missing = used.filter((c) => !defined.has(c))

    expect(missing, `Classes used in TSX but not defined in CSS: ${missing.join(", ")}`).toEqual([])
  })

  it("all am- classes defined in CSS should be used in TSX", () => {
    const css = readAllCss() + fs.readFileSync(SHARED_CSS, "utf-8")
    const tsx = readAllTsx()

    // Extract am- classes defined in CSS
    const cssMatches = [...css.matchAll(/\.([a-z][a-z0-9-]*)/gi)]
    const defined = [...new Set(cssMatches.map((m) => m[1]!).filter((n) => n.startsWith("am-")))]

    const unused = defined.filter((c) => !tsx.includes(c!))

    expect(unused, `Classes defined in CSS but not used in TSX: ${unused.join(", ")}`).toEqual([])
  })
})

describe("Browser module boundaries", () => {
  it("keeps browser core independent from Agent Manager and VS Code context", () => {
    const files = ["BrowserPanel.tsx", "controller.ts", "types.ts", "index.ts"]
    for (const file of files) {
      const source = fs.readFileSync(path.join(ROOT, "webview-ui/browser", file), "utf-8")
      expect(source).not.toMatch(/agent-manager|AgentManager|SidePanel|useVSCode|window\.postMessage/)
    }
  })

  it("owns browser styles in the reusable module", () => {
    const css = fs.readFileSync(path.join(ROOT, "webview-ui/agent-manager/agent-manager.css"), "utf-8")
    const browser = fs.readFileSync(path.join(ROOT, "webview-ui/browser/BrowserPanel.tsx"), "utf-8")
    expect(css).not.toContain(".am-browser-")
    expect(browser).toContain('import "./browser.css"')
  })
})

describe("Agent Manager edit preview", () => {
  it("provides a visible close action", () => {
    const source = fs.readFileSync(EDIT_PREVIEW_PANEL_FILE, "utf-8")
    expect(source).toContain('icon="close"')
    expect(source).toContain('class="am-edit-preview-close"')
    expect(source).toContain("onClick={props.state.close}")
  })

  it("drives every stacked file from one shared style control", () => {
    const source = fs.readFileSync(EDIT_PREVIEW_PANEL_FILE, "utf-8")
    expect(source).toContain("RadioGroup")
    expect(source).toContain("styleSelect={false}")
  })

  it("sizes stacked files to their own diff instead of a fixed height", () => {
    const css = readAllCss()
    expect(css).toContain(".am-edit-preview-files > .am-review-layout")
    expect(css).not.toContain("flex: 0 0 min(420px, 50%)")
    const view = fs.readFileSync(path.join(ROOT, "webview-ui/diff-viewer/VirtualDiffView.tsx"), "utf-8")
    expect(view).toContain("value.fileDiff.hunks.length")
    expect(view).toContain("virtualized={heavy()}")
  })
})

describe("Agent Manager Provider Messages", () => {
  const source = fs.readFileSync(PROVIDER_FILE, "utf-8")

  it("fail-closes leftover worktree and Kilo session orchestration", () => {
    expect(source).toContain("尚未迁移到 CodeM App Server")
    expect(source).toContain("agentManager.requestState")
    expect(source).toContain("agentManager.requestProjects")
    expect(source).not.toContain("createProjectWiring(")
    expect(source).not.toContain("new WorktreeDiffController(")
    expect(source).not.toContain("WorktreeImporter")
    expect(source).not.toContain("connectionService.getClient()")
  })
})

describe("Agent Manager Model Picker", () => {
  it("discloses data collection for free models in compare picker", () => {
    const source = fs.readFileSync(path.join(ROOT, "webview-ui/agent-manager/MultiModelSelector.tsx"), "utf-8")

    expect(source).toContain("model.tag.dataCollected")
    expect(source).toContain("model.isFree")
  })
})

describe("Agent Manager Worktree Actions", () => {
  it("opens the configuration dialog from the primary plus action", () => {
    const source = fs.readFileSync(path.join(ROOT, "webview-ui/agent-manager/ProjectActions.tsx"), "utf-8")
    const start = source.indexOf('<div class="am-split-button">')
    const end = source.indexOf("</div>", start)
    const actions = source.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(actions).toContain("onClick={props.onNew}")
    expect(actions).toContain('keybind={props.bindings.newWorktree ?? ""}')
    expect(actions).toContain("<DropdownMenu.Item onSelect={props.onCreate}>")
    expect(actions).toContain('props.t("sidebar.session.newWorktree.from")')
    expect(actions).toContain('props.bindings.quickWorktree ?? ""')
    expect(actions).not.toContain("onSelect={props.onNew}")
  })

  it("opens the configuration dialog from the new-worktree shortcut", () => {
    const source = fs.readFileSync(TSX_FILE, "utf-8")
    const start = source.indexOf('else if (msg.action === "newWorktree")')
    const end = source.indexOf('else if (msg.action === "quickWorktree")', start)
    const action = source.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(action).toContain("showNewWorktreeDialog()")
  })

  it("creates a worktree from the quick-worktree shortcut", () => {
    const source = fs.readFileSync(TSX_FILE, "utf-8")
    const start = source.indexOf('else if (msg.action === "quickWorktree")')
    const end = source.indexOf('else if (msg.action === "openWorktree")', start)
    const action = source.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(action).toContain("handleCreateWorktree()")
  })

  it("registers distinct dialog and quick-create worktree shortcuts", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")) as {
      contributes: { keybindings: { command: string; key?: string; mac?: string }[] }
    }
    const dialog = manifest.contributes.keybindings.find((item) => item.command === "codem.agentManager.newWorktree")
    const quick = manifest.contributes.keybindings.find((item) => item.command === "codem.agentManager.quickWorktree")

    expect(dialog).toMatchObject({ key: "ctrl+n", mac: "cmd+n" })
    expect(quick).toMatchObject({ key: "ctrl+shift+n", mac: "cmd+shift+n" })
    const bindings = fs.readFileSync(KEYBIND_DEFAULTS_FILE, "utf-8")
    expect(bindings).toContain('newWorktree: isMac ? "⌘N" : "Ctrl+N"')
    expect(bindings).toContain('quickWorktree: isMac ? "⌘⇧N" : "Ctrl+Shift+N"')
  })

  it("reserves Cmd+Shift+M for the Agent Manager instead of Problems", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")) as {
      contributes: { keybindings: { command: string; key?: string; mac?: string }[] }
    }
    const removed = manifest.contributes.keybindings.find((item) => item.command === "-workbench.actions.view.problems")
    const manager = manifest.contributes.keybindings.find((item) => item.command === "codem.agentManagerOpen")

    expect(removed).toMatchObject({ key: "ctrl+shift+m", mac: "cmd+shift+m" })
    expect(manager).toMatchObject({ key: "ctrl+shift+m", mac: "cmd+shift+m" })
  })

  it("routes prompt and side-terminal shortcut actions separately", () => {
    const source = fs.readFileSync(TSX_FILE, "utf-8")
    const start = source.indexOf('else if (msg.action === "newTerminalTab")')
    const end = source.indexOf('else if (msg.action === "cycleAgentMode"', start)
    const action = source.slice(start, end)

    expect(action).toContain('msg.action === "newTerminalTab"')
    expect(action).toContain("termHandlers.requestNew()")
    expect(action).toContain('msg.action === "newSideTerminal"')
    expect(action).toContain("termHandlers.addSide()")
    expect(action).not.toContain('msg.action === "newMainTerminal"')
  })

  it("keeps Cmd+W terminal handling before the empty-worktree fallback", () => {
    const source = fs.readFileSync(TSX_FILE, "utf-8")
    const start = source.indexOf("const closeActiveTab = () =>")
    const end = source.indexOf("// Close the currently selected worktree", start)
    const action = source.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(action).toContain("termHandlers.closeFocused()")
    expect(action).toContain("termHandlers.closeActive()")
    expect(action).toContain("if (tabs.length === 0)")
  })

  it("forwards the quick-worktree command to immediate creation", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/extension.ts"), "utf-8")
    const start = source.indexOf('vscode.commands.registerCommand("codem.agentManager.quickWorktree"')
    const end = source.indexOf('vscode.commands.registerCommand("codem.agentManager.openWorktree"', start)
    const command = source.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(command).toContain('agentManagerProvider.postMessage({ type: "action", action: "quickWorktree" })')
  })

  it("shows the same mapping in the keyboard shortcuts dialog", () => {
    const source = fs.readFileSync(path.join(ROOT, "webview-ui/agent-manager/shortcuts.ts"), "utf-8")

    expect(source).toContain('t("agentManager.shortcuts.advancedWorktree"), binding: bindings.newWorktree')
    expect(source).toContain('t("agentManager.shortcuts.newWorktree"), binding: bindings.quickWorktree')
  })

  it("does not attribute the new-worktree shortcut to session promotion", () => {
    const source = fs.readFileSync(path.join(ROOT, "webview-ui/agent-manager/SessionRowActions.tsx"), "utf-8")

    expect(source).toContain('t("agentManager.session.openInWorktree")')
    expect(source).not.toContain("TooltipKeybind")
  })
})

// ---------------------------------------------------------------------------
// Provider message routing — static-analysis regression tests
//
// These tests use ts-morph to inspect the source code of AgentManagerProvider
// and verify structural invariants that prevent regressions without needing
// a VS Code test host.
// ---------------------------------------------------------------------------

describe("Agent Manager Webview — non-git sessionsLoaded fix", () => {
  const tsx = readAllTsx()

  /**
   * Regression: when isGitRepo is false, the CodeM server never sends a
   * "sessionsLoaded" message, so the skeleton was stuck forever.
   * The fix must set sessionsLoaded(true) when receiving a state message
   * with isGitRepo === false.
   */
  it("sets sessionsLoaded when agentManager.state arrives with isGitRepo false", () => {
    // Find the agentManager.state handler block
    const start = tsx.indexOf('"agentManager.state"')
    expect(start, "agentManager.state handler must exist").toBeGreaterThan(-1)
    const snippet = tsx.slice(start, start + 1600)
    expect(snippet, "must call setSessionsLoaded in the non-git branch").toContain("setSessionsLoaded")
    expect(snippet, "must check isGitRepo === false before setting sessionsLoaded").toMatch(
      /isGitRepo.*false|false.*isGitRepo/,
    )
  })
})

// ---------------------------------------------------------------------------
// CodeMProvider — pendingSessionRefresh race condition fix
// ---------------------------------------------------------------------------

describe("CodeMProvider — pending session refresh on reconnect", () => {
  const provider = fs.readFileSync(KILO_PROVIDER_FILE, "utf-8")
  const utils = fs.readFileSync(path.join(ROOT, "src/host/utils.ts"), "utf-8")

  /**
   * Regression: when the Agent Manager opens its panel, initializeState()
   * calls refreshSessions() before the CLI server has started. Because
   * httpClient is null at that point, handleLoadSessions() used to bail
   * with an error message and never send "sessionsLoaded" to the webview.
   * The worktree would show up in the sidebar but display "No sessions open".
   *
   * The fix uses a pendingSessionRefresh flag: loadSessions() (in
   * host/utils) sets it when httpClient is unavailable, and
   * both initializeConnection() and the "connected" state handler flush
   * the pending refresh.
   */
  it("loadSessions sets pendingSessionRefresh when client is null", () => {
    const start = utils.indexOf("export async function loadSessions")
    expect(start, "loadSessions must exist in host/utils").toBeGreaterThan(-1)
    const snippet = utils.slice(start, start + 700)
    expect(snippet, "must set pendingSessionRefresh when client missing").toContain("ctx.pendingSessionRefresh = true")
    expect(snippet, "must avoid noisy errors while still connecting").toContain('ctx.connectionState !== "connecting"')
    expect(snippet, "must clear pendingSessionRefresh on successful entry").toContain(
      "ctx.pendingSessionRefresh = false",
    )
  })

  it("handleLoadSessions delegates to loadSessionsUtil", () => {
    const start = provider.indexOf("private async handleLoadSessions()")
    expect(start, "handleLoadSessions must exist").toBeGreaterThan(-1)
    const snippet = provider.slice(start, start + 400)
    expect(snippet, "must call loadSessionsUtil").toContain("loadSessionsUtil")
  })

  it("connected state handler flushes deferred session refresh", () => {
    // Find the onStateChange callback that handles "connected"
    const connectedIdx = provider.indexOf('state === "connected"')
    expect(connectedIdx, '"connected" state handler must exist').toBeGreaterThan(-1)
    const end = provider.indexOf("this.unsubscribeNotificationDismiss", connectedIdx)
    expect(end, "notification subscription must follow connection handler").toBeGreaterThan(connectedIdx)
    const snippet = provider.slice(connectedIdx, end)
    expect(snippet, "must call flushPendingSessionRefresh from connected handler").toContain(
      'this.flushPendingSessionRefresh("sse-connected")',
    )
  })

  it("initializeConnection flushes deferred refresh for missed connected events", () => {
    const initIdx = provider.indexOf('this.syncWebviewState("initializeConnection")')
    expect(initIdx, "initializeConnection sync call must exist").toBeGreaterThan(-1)
    const snippet = provider.slice(initIdx, initIdx + 220)
    expect(snippet, "must flush deferred session refresh in initializeConnection").toContain(
      'this.flushPendingSessionRefresh("initializeConnection")',
    )
  })

  it("pendingSessionRefresh is declared as a class field", () => {
    expect(provider, "pendingSessionRefresh field must be declared").toMatch(
      /private\s+pendingSessionRefresh\s*=\s*false/,
    )
  })
})

// ---------------------------------------------------------------------------
describe("Agent Manager — VS Code import boundary", () => {
  it("routes GitHub CLI execution through execGhRead", () => {
    const gh = path.join(AGENT_MANAGER_DIR, "gh.ts")
    const violations = agentManagerSourceFiles()
      .map((file) => path.join(AGENT_MANAGER_DIR, file))
      .filter((file) => file !== gh)
      .filter((file) => /(["'])gh(?:\.exe)?\1/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.basename(file))
    expect(violations).toEqual([])
  })

  it("only allowlisted files may import vscode", () => {
    const violations: string[] = []
    for (const file of agentManagerSourceFiles()) {
      if (file in VSCODE_ALLOWED) continue
      const content = fs.readFileSync(path.join(AGENT_MANAGER_DIR, file), "utf-8")
      if (importsVscode(content)) violations.push(file)
    }
    expect(
      violations,
      `These files import "vscode" but are not on the exception list.\n` +
        `Either extract the vscode dependency or add them to VSCODE_ALLOWED:\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    ).toEqual([])
  })

  it("capped files stay within their maxLines limit", () => {
    const overweight: string[] = []
    for (const [file, { maxLines }] of Object.entries(MAX_LINES)) {
      const filepath = path.join(AGENT_MANAGER_DIR, file)
      if (!fs.existsSync(filepath)) continue
      const lines = fs.readFileSync(filepath, "utf-8").split("\n").length
      if (lines > maxLines) overweight.push(`${file}: ${lines} lines (cap: ${maxLines})`)
    }
    expect(
      overweight,
      `File too large — needs better modularization.\n\n` +
        overweight.map((o) => `  ${o}`).join("\n") +
        `\n\n` +
        `Do NOT raise maxLines. Instead, extract logic into a vscode-free\n` +
        `helper module and call it from the provider. See fork-session.ts\n` +
        `for an example of this pattern.`,
    ).toEqual([])
  })

  it("every allowlisted file actually exists", () => {
    const stale = Object.keys(VSCODE_ALLOWED).filter((f) => !fs.existsSync(path.join(AGENT_MANAGER_DIR, f)))
    expect(
      stale,
      `These files are in VSCODE_ALLOWED but no longer exist — remove them:\n` +
        stale.map((s) => `  - ${s}`).join("\n"),
    ).toEqual([])
  })

  it("every allowlisted file actually imports vscode", () => {
    const unnecessary: string[] = []
    for (const file of Object.keys(VSCODE_ALLOWED)) {
      const filepath = path.join(AGENT_MANAGER_DIR, file)
      if (!fs.existsSync(filepath)) continue
      if (!importsVscode(fs.readFileSync(filepath, "utf-8"))) unnecessary.push(file)
    }
    expect(
      unnecessary,
      `These files no longer import "vscode" — remove them from VSCODE_ALLOWED:\n` +
        unnecessary.map((u) => `  - ${u}`).join("\n"),
    ).toEqual([])
  })
})

const APP_FILE = path.join(ROOT, "webview-ui/src/App.tsx")
const AGENT_MANAGER_APP_FILE = path.join(ROOT, "webview-ui/agent-manager/AgentManagerApp.tsx")
const PROVIDER_SHELL_FILE = path.join(ROOT, "webview-ui/src/context/provider-shell.tsx")

describe("Shared webview provider shell", () => {
  function ordered(source: string, names: string[]) {
    const positions = names.map((name) => source.indexOf(`<${name}`))
    expect(
      positions.every((position) => position >= 0),
      `Missing provider from ${names.join(" -> ")}`,
    ).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  }

  it("owns the common provider order and bridges", () => {
    const source = fs.readFileSync(PROVIDER_SHELL_FILE, "utf-8")
    ordered(source, [
      "ThemeProvider",
      "DialogProvider",
      "VSCodeProvider",
      "MermaidDownloadBridge",
      "ServerProvider",
      "LanguageBridge",
      "MarkedProvider",
      "DiffComponentProvider",
      "CodeComponentProvider",
      "FileComponentProvider",
      "ProviderProvider",
      "ConfigProvider",
      "DisplayProvider",
      "IndexingProvider",
      "KiloEmbeddingModelsProvider",
      "ImageModelsProvider",
      "NotificationsProvider",
      "SessionProvider",
      "MemoryProvider",
      "FeedbackProvider",
    ])
    expect(source.indexOf("<Toast.Region")).toBeGreaterThan(source.indexOf("</VSCodeProvider>"))
  })

  it("keeps sidebar-only providers in the sidebar root", () => {
    const source = fs.readFileSync(APP_FILE, "utf-8")
    ordered(source, [
      "ProviderShell.Root",
      "WorkStyleProvider",
      "ProviderShell.Session",
      "LocalTabsProvider",
      "ProviderShell.Chat",
      "DataBridge",
      "AppContent",
    ])
    expect(fs.readFileSync(PROVIDER_SHELL_FILE, "utf-8")).not.toMatch(/WorkStyleProvider|LocalTabsProvider/)
  })

  it("keeps worktree mode in the Agent Manager root", () => {
    const source = fs.readFileSync(AGENT_MANAGER_APP_FILE, "utf-8")
    ordered(source, [
      "ProviderShell.Root",
      "ProviderShell.Session",
      "ProviderShell.Chat",
      "WorktreeModeProvider",
      "DataBridge",
      "AgentManagerContent",
    ])
    expect(fs.readFileSync(PROVIDER_SHELL_FILE, "utf-8")).not.toContain("WorktreeModeProvider")
  })
})

describe("Agent Manager worktree setup", () => {
  it("retains the guarded setup error delay", () => {
    const source = fs.readFileSync(AGENT_MANAGER_APP_FILE, "utf-8")
    const timer = source.match(/if \(next.active && next.error\)[\s\S]*?,\s*3000,\s*\)/)?.at(0)
    expect(timer).toContain("globalThis.setTimeout")
    expect(timer).toContain('current === next ? { active: false, message: "" } : current')
  })
})
