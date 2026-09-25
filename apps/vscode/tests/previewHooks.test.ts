import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, after, it } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"
import { commandUnavailable, slashCatalog } from "../../../packages/ui/src/chat/slashCommands.ts"
import type { ChatSnapshot as UiSnapshot } from "../../../packages/ui/src/contract.ts"
import { chatHtml } from "../src/chat/html.ts"
import type { AccountState } from "../src/shared/accountTypes.ts"
import { VscodeHostBridge } from "../webview/host/vscodeHostBridge.ts"
import { parseMarkup, querySelector, textContent, type MarkupElement } from "./markupQuery.ts"
import { fixtureHooks, sessionCommand, slashSubmit, surfaceEntry } from "./previewHooks.ts"
import { previewScenarios } from "./previewScenarios.ts"
import { createPreviewState, parsePreviewSearch } from "./previewState.ts"

// Renders the real @codem/ui ChatApp from each preview fixture, projected by the production bridge,
// and checks every hook the preview runtime waits for before it drives a surface.
const appRoot = fileURLToPath(new URL("..", import.meta.url))
let directory = ""
let renderChat: (host: unknown, initial: UiSnapshot) => string
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "codem-preview-hooks-"))
  const outfile = join(directory, "chat.cjs")
  await build({ outfile, bundle: true, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' }, stdin: {
    resolveDir: appRoot,
    contents: `import { createElement } from "react"; import { renderToStaticMarkup } from "react-dom/server"; import { ChatApp } from "../../packages/ui/src/chat/ChatApp.tsx";
export const renderChat = (host, initial) => renderToStaticMarkup(createElement(ChatApp, { host, initial }))`,
  } })
  renderChat = (await import(pathToFileURL(outfile).href)).default.renderChat
})
after(() => rm(directory, { recursive: true, force: true }))

const signedIn: AccountState = { status: "signedIn", profile: { avatar: { kind: "none" }, displayName: "林晓", userId: "preview-user", tenantId: "preview-team", authMethod: "browser" }, refreshing: false, notice: null }
/** The markup ChatApp renders once the runtime has published this scenario's fixture. */
function renderScenario(scenario: string, options: { account?: AccountState; draft?: (state: ReturnType<typeof createPreviewState>) => string } = {}) {
  const state = createPreviewState(parsePreviewSearch({ scenario }))
  const bridge = new VscodeHostBridge()
  for (const message of [{ type: "account", state: options.account ?? signedIn }, state.demo, { type: "panel", panel: state.activePanel }]) bridge.receive(structuredClone(message))
  const snapshot = bridge.snapshot()
  const draft = options.draft?.(state) ?? ""
  const host = { surface: "editor", getState: () => ({ draft }), subscribe: () => () => {}, subscribeDraft: () => () => {}, postAction: () => {}, setState: () => {} }
  return { ...state, snapshot, markup: renderChat(host, snapshot) }
}
function has(root: MarkupElement, selector: string, scenario: string) {
  assert.ok(querySelector(root, selector), `${scenario}: @codem/ui does not render ${selector}`)
}

it("renders every hook the preview runtime waits for in each scenario", () => {
  const surfaces = new Set<string>()
  for (const [scenario] of previewScenarios) {
    const { demo, surface, snapshot, markup } = renderScenario(scenario, { draft: state => state.surface === "sessionTools" ? `/${sessionCommand(scenario, state.demo)}` : "" })
    const root = parseMarkup(markup)
    const fixture = fixtureHooks(demo)
    has(root, fixture.selector, scenario)
    assert.equal(textContent(querySelector(root, "#workspace")!), fixture.workspace, `${scenario}: workspace label`)
    if (!surface) continue
    surfaces.add(surface)
    has(root, surfaceEntry(surface), scenario)
    if (surface !== "sessionTools") continue
    // The slash draft can be submitted, and the command it opens is listed and available for this fixture.
    const command = sessionCommand(scenario, demo)
    has(root, slashSubmit, scenario)
    assert.ok(slashCatalog(snapshot).some(item => item.id === command), `${scenario}: /${command} is not in the slash menu`)
    assert.equal(commandUnavailable(command, snapshot), null, `${scenario}: /${command} is unavailable`)
  }
  assert.deepEqual([...surfaces].sort(), ["activities", "background", "capabilities", "effort", "files", "model", "permissionMode", "sessionTools", "space", "tools", "workMode"])
})

it("rejects hooks that @codem/ui does not render for the fixture", () => {
  const catalog = renderScenario("catalogPlugins", { draft: () => "/catalog" })
  const root = parseMarkup(catalog.markup)
  // Pre-@codem/ui composer hooks that left session-tool and menu scenarios unmounted.
  assert.equal(querySelector(root, `#slashCommandsHost[data-thread-id="preview"]`), null)
  const model = parseMarkup(renderScenario("model").markup)
  assert.ok(querySelector(model, surfaceEntry("model")))
  assert.equal(querySelector(model, `#selectModel[data-menu-scope=${JSON.stringify(JSON.stringify(["codem-plugin", "研发团队", null]))}]:not(:disabled)`), null)
  // A previous scene's thread or phase is not this fixture.
  assert.equal(querySelector(root, fixtureHooks({ ...catalog.demo, threadId: "preview1" }).selector), null)
  assert.equal(querySelector(root, fixtureHooks({ ...catalog.demo, phase: "running" }).selector), null)
  // An empty draft cannot be submitted, and a pending panel disables the prompt.
  assert.equal(querySelector(parseMarkup(renderScenario("catalogPlugins").markup), slashSubmit), null)
  assert.equal(querySelector(parseMarkup(renderScenario("approval").markup), surfaceEntry("sessionTools")), null)
  assert.throws(() => querySelector(root, "#prompt ~ #send"), /Unsupported selector/)
})

it("lays out the preview around the element the webview mounts @codem/ui into", async () => {
  const signedOut = renderScenario("accountSignedOut", { account: { status: "signedOut", notice: null } })
  const page = parseMarkup(chatHtml({ surface: "editor", script: "/webview.js", style: "/webview.css", logo: "/logo.svg", cspSource: "http://127.0.0.1" })
    .replace(/(<div id="codem-root"[^>]*>)<\/div>/, (_, open: string) => `${open}${signedOut.markup}</div>`))
  const css = await readFile(new URL("preview.css", import.meta.url), "utf8")
  const selectors = [...css.matchAll(/^(body > [^{]+)\{/gm)].flatMap(([, list]) => list!.split(",").map(selector => selector.trim()))
  assert.ok(selectors.length >= 2)
  for (const selector of selectors) has(page, selector, "preview.css")
  assert.equal(querySelector(page, "body > .app"), null)
  assert.equal(querySelector(page, "body > #accountRoot .accountPage"), null)
})
