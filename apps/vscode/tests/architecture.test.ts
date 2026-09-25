import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { it, type TestContext } from "node:test"
import { checkWorkspaceArchitecture } from "./architectureChecks.ts"

const workspace = fileURLToPath(new URL("../../..", import.meta.url))

async function put(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), content)
}

async function fixture(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codem-architecture-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const name of ["app-server", "history", "protocol"]) {
    await put(root, `packages/${name}/src/index.ts`, "export const value = 1")
    await put(root, `packages/${name}/package.json`, JSON.stringify({ name: `@codem/${name}` }))
    await put(root, `packages/${name}/tsconfig.json`, JSON.stringify({ compilerOptions: { lib: ["ES2023"], types: name === "protocol" ? [] : ["node"] } }))
  }
  await put(root, "apps/vscode/src/index.ts", 'export { value } from "@codem/protocol"')
  await put(root, "apps/vscode/webview/index.ts", "export const value = 1")
  return root
}

it("architecture gate: active workspace respects source and platform boundaries", async () => {
  await checkWorkspaceArchitecture(workspace)
})

it("jetbrains directories follow the documented duty split", () => {
  for (const directory of ["core", "account", "session", "history", "ide", "webview"]) {
    assert.ok(existsSync(join(workspace, "apps/jetbrains/src/main/kotlin/com/codem/intellij", directory)))
  }
  assert.ok(existsSync(join(workspace, "apps/jetbrains/src/plugin/kotlin/com/codem/intellij/bootstrap")))
  assert.ok(existsSync(join(workspace, "apps/jetbrains/tests")))
})

it("architecture gate: accepts Node services, local protocol code and public package imports", async t => {
  const root = await fixture(t)
  await put(root, "packages/app-server/src/index.ts", 'export { join } from "node:path"; export { value } from "@codem/protocol"')
  await put(root, "packages/protocol/src/index.ts", 'export { value } from "./value.ts"')
  await put(root, "packages/protocol/src/value.ts", "export const value = 1")
  await checkWorkspaceArchitecture(root)
})

it("application boundaries: accepts shared contracts and Host bridge composition", async t => {
  const root = await fixture(t)
  await put(root, "apps/vscode/src/shared/messages.ts", 'export { value } from "@codem/protocol"')
  await put(root, "apps/vscode/webview/host/bridge.ts", 'export { value } from "../../src/shared/messages.ts"')
  await put(root, "apps/vscode/webview/main.ts", 'export { value } from "./host/bridge.ts"')
  await checkWorkspaceArchitecture(root)
})

for (const [importer, target, message] of [
  ["webview/host/bridge.ts", "src/chat/controller.ts", "Webview cannot import Host implementation"],
  ["src/shared/messages.ts", "src/chat/controller.ts", "application contracts cannot depend on features"],
] as const) {
  it(`application boundaries: rejects ${importer} depending on ${target}, including aliases`, async t => {
    const root = await fixture(t)
    await put(root, `apps/vscode/${target}`, "export const value = 1")
    await put(root, "apps/vscode/tsconfig.json", JSON.stringify({ compilerOptions: { paths: { "@forbidden": [`./${target}`] } } }))
    await put(root, `apps/vscode/${importer}`, 'export { value } from "@forbidden"')
    await assert.rejects(checkWorkspaceArchitecture(root), new RegExp(message))
  })
}

it("application boundaries: lint rejects erased Host and feature type dependencies", async t => {
  const root = await fixture(t)
  await put(root, ".oxlintrc.json", await readFile(join(workspace, ".oxlintrc.json"), "utf8"))
  for (const [path, source] of [
    ["webview/host/bridge.ts", 'export type { ChatController } from "../../src/chat/chatController.ts"'],
    ["src/shared/messages.ts", 'export type { ChatController } from "../chat/chatController.ts"'],
  ]) {
    const file = `apps/vscode/${path}`
    await put(root, file, source!)
    assert.throws(() => execFileSync(join(workspace, "node_modules/.bin/oxlint"), ["--deny-warnings", file], { cwd: root, encoding: "utf8", stdio: "pipe" }), error => {
      const failure = error as Error & { status: number; stdout: string }
      assert.equal(failure.status, 1)
      assert.match(failure.stdout, /no-restricted-imports/)
      return true
    })
  }
})

for (const source of [
  'import "../../../history/old.ts"',
  'export { value } from "../../../history/old.ts"',
  'export const load = () => import("../../../history/old.ts")',
  'export const value = require("../../../history/old.ts")',
]) {
  it(`architecture gate: rejects archived code via ${source}`, async t => {
    const root = await fixture(t)
    await put(root, "apps/vscode/src/index.ts", source)
    await assert.rejects(checkWorkspaceArchitecture(root), /archived imports are forbidden/)
  })
}

it("architecture gate: allows the active history package without treating it as the archive", async t => {
  const root = await fixture(t)
  await put(root, "packages/history/src/index.ts", "export const value = 1")
  await put(root, "apps/vscode/src/index.ts", 'export { value } from "@codem/protocol"')
  await checkWorkspaceArchitecture(root)
})

it("architecture gate: rejects history reached through a TS alias or symlink", async t => {
  const root = await fixture(t)
  await put(root, "history/old.ts", "export const value = 1")
  await put(root, "apps/vscode/tsconfig.json", JSON.stringify({ compilerOptions: { paths: { "@legacy/*": ["../../history/*"] } } }))
  await put(root, "apps/vscode/src/index.ts", 'export { value } from "@legacy/old.ts"')
  await assert.rejects(checkWorkspaceArchitecture(root), /resolution reaches archived source/)
  await put(root, "apps/vscode/src/index.ts", 'export { value } from "./linked.ts"')
  await symlink(join(root, "history/old.ts"), join(root, "apps/vscode/src/linked.ts"))
  await assert.rejects(checkWorkspaceArchitecture(root), /source resolves into history/)
})

it("architecture gate: UI may use React and must reject Node, VS Code and App Server", async t => {
  const root = await fixture(t)
  await put(root, "packages/ui/package.json", JSON.stringify({
    name: "@codem/ui",
    dependencies: { "@codem/protocol": "workspace:*", react: "19.3.0", marked: "18.0.13", dompurify: "3.4.15" },
  }))
  await put(root, "packages/ui/src/index.ts", 'import { useState } from "react"; export const hook = useState')
  await checkWorkspaceArchitecture(root)
  await put(root, "packages/ui/src/index.ts", 'export { window } from "vscode"')
  await assert.rejects(checkWorkspaceArchitecture(root), /UI cannot import Node or editor hosts/)
  await put(root, "packages/ui/src/index.ts", 'export { join } from "node:path"')
  await assert.rejects(checkWorkspaceArchitecture(root), /UI cannot import Node or editor hosts/)
  await put(root, "packages/ui/src/index.ts", "export const value = 1")
  await put(root, "packages/ui/package.json", JSON.stringify({ name: "@codem/ui", dependencies: { "@codem/app-server": "workspace:*" } }))
  await assert.rejects(checkWorkspaceArchitecture(root), /UI cannot depend on/)
})

for (const source of ['export { window } from "vscode"', 'export const load = () => import("electron")']) {
  it(`architecture gate: rejects platform dependency ${source}`, async t => {
    const root = await fixture(t)
    await put(root, "packages/app-server/src/index.ts", source)
    await assert.rejects(checkWorkspaceArchitecture(root), /cannot import an editor\/UI runtime/)
  })
}

it("architecture gate: rejects shared code reaching application internals", async t => {
  const root = await fixture(t)
  await put(root, "packages/history/src/index.ts", 'export { value } from "../../../apps/vscode/src/index.ts"')
  await assert.rejects(checkWorkspaceArchitecture(root), /crossing source directories/)
})

it("architecture gate: rejects protocol runtime imports and declared runtime dependencies", async t => {
  const root = await fixture(t)
  await put(root, "packages/protocol/src/index.ts", 'export { join } from "node:path"')
  await assert.rejects(checkWorkspaceArchitecture(root), /protocol cannot have external runtime imports/)
  await put(root, "packages/protocol/src/index.ts", "export const value = 1")
  for (const kind of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    await put(root, "packages/protocol/package.json", JSON.stringify({ [kind]: { zod: "4.1.8" } }))
    await assert.rejects(checkWorkspaceArchitecture(root), /forbidden .*Dependencies|forbidden dependencies/)
  }
})

it("architecture gate: rejects DOM libraries and ambient editor types in shared packages", async t => {
  const root = await fixture(t)
  await put(root, "packages/app-server/tsconfig.json", JSON.stringify({ compilerOptions: { lib: ["ES2023", "DOM"], types: ["node"] } }))
  await assert.rejects(checkWorkspaceArchitecture(root), /without DOM/)
  await put(root, "packages/app-server/tsconfig.json", JSON.stringify({ compilerOptions: { lib: ["ES2023"], types: ["node", "vscode"] } }))
  await assert.rejects(checkWorkspaceArchitecture(root), /ambient platform types/)
})

it("architecture gate: lint rejects even erased editor type imports", async t => {
  const root = await fixture(t)
  await put(root, ".oxlintrc.json", await readFile(join(workspace, ".oxlintrc.json"), "utf8"))
  await put(root, "packages/app-server/src/index.ts", 'export type { ExtensionContext } from "vscode"')
  assert.throws(() => execFileSync(join(workspace, "node_modules/.bin/oxlint"), ["--deny-warnings", "packages/app-server/src/index.ts"], { cwd: root, encoding: "utf8", stdio: "pipe" }), error => {
    const failure = error as Error & { status: number; stdout: string }
    assert.equal(failure.status, 1)
    assert.match(failure.stdout, /no-restricted-imports/)
    return true
  })
})

for (const owner of ["src/resources/conversationResources.ts", "src/chat/backgroundTasks.ts", "src/sessionHistory/conversationHistory.ts"]) {
  it(`conversation boundary rejects reverse coordinator dependencies from ${owner}, including aliases and types`, async t => {
    const root = await fixture(t)
    await put(root, "apps/vscode/src/chat/chatController.ts", "export class ChatController {}")
    await put(root, "apps/vscode/src/shared/messages.ts", "export interface Snapshot { phase: string }")
    await put(root, `apps/vscode/${owner}`, 'import type { Snapshot } from "../shared/messages.ts"; export const state: Snapshot = { phase: "ready" }')
    await checkWorkspaceArchitecture(root)
    await put(root, "apps/vscode/tsconfig.json", JSON.stringify({ compilerOptions: { paths: { "@coordinator": ["./src/chat/chatController.ts"] } } }))
    await put(root, `apps/vscode/${owner}`, 'export { ChatController } from "@coordinator"')
    await assert.rejects(checkWorkspaceArchitecture(root), /conversation state owners cannot import the coordinator/)
    await put(root, ".oxlintrc.json", await readFile(join(workspace, ".oxlintrc.json"), "utf8"))
    await put(root, `apps/vscode/${owner}`, 'export type { ChatController } from "../chat/chatController.ts"')
    assert.throws(() => execFileSync(join(workspace, "node_modules/.bin/oxlint"), ["--deny-warnings", `apps/vscode/${owner}`], { cwd: root, encoding: "utf8", stdio: "pipe" }), error => {
      const failure = error as Error & { status: number; stdout: string }
      assert.equal(failure.status, 1)
      assert.match(failure.stdout, /no-restricted-imports/)
      return true
    })
  })
}

const settingsOwner = "apps/vscode/src/chat/chatSettings.ts"
/** A settings owner that uses only what it needs: shared contracts, persistence types, the catalog view and the portable packages. */
const settingsSource = 'import type { Settings } from "../shared/composerSettings.ts"; import type { Store } from "../connection/connectionPreferences.ts"; import { catalog } from "./composerCatalog.ts"; import { value } from "@codem/protocol"; import { join } from "node:path"; export const owner: [Settings?, Store?] = []; export const use = [catalog, value, join]'
async function settingsFixture(t: TestContext): Promise<string> {
  const root = await fixture(t)
  for (const [path, source] of [
    ["src/shared/composerSettings.ts", "export interface Settings { effort: string }"],
    ["src/connection/connectionPreferences.ts", "export interface Store { load(): unknown }"],
    ["src/chat/composerCatalog.ts", "export const catalog = 1"],
    ["src/chat/chatController.ts", "export class ChatController {}"],
    ["src/chat/chatSurfaces.ts", "export class ChatSurfaces {}"],
    ["src/extension.ts", "export function activate() {}"],
    ["src/nativeChat/nativeChatExtension.ts", "export function activate() {}"],
    ["src/panels/panelBroker.ts", "export class PanelBroker {}"],
    ["webview/host/vscodeHostBridge.ts", "export class VscodeHostBridge {}"],
  ] as const) await put(root, `apps/vscode/${path}`, source)
  await put(root, settingsOwner, settingsSource)
  return root
}

it("settings boundary: accepts shared contracts, persistence, the catalog view and portable packages", async t => {
  const root = await settingsFixture(t)
  await checkWorkspaceArchitecture(root)
  await put(root, ".oxlintrc.json", await readFile(join(workspace, ".oxlintrc.json"), "utf8"))
  execFileSync(join(workspace, "node_modules/.bin/oxlint"), ["--deny-warnings", settingsOwner], { cwd: root, encoding: "utf8", stdio: "pipe" })
})

for (const [target, source] of [
  ["the coordinator through an alias", 'export { ChatController } from "@coordinator"'],
  ["the chat surfaces", 'export { ChatSurfaces } from "./chatSurfaces.ts"'],
  ["the entry point", 'export { activate } from "../extension.ts"'],
  ["the native chat entry point", 'export { activate } from "../nativeChat/nativeChatExtension.ts"'],
  ["the Host panel broker", 'export { PanelBroker } from "../panels/panelBroker.ts"'],
  ["the Webview bridge", 'export { VscodeHostBridge } from "../../webview/host/vscodeHostBridge.ts"'],
  ["the shared UI", 'export { ChatApp } from "@codem/ui"'],
  ["the editor runtime", 'export { window } from "vscode"'],
] as const) {
  it(`settings boundary: rejects importing ${target}`, async t => {
    const root = await settingsFixture(t)
    await put(root, "apps/vscode/tsconfig.json", JSON.stringify({ compilerOptions: { paths: { "@coordinator": ["./src/chat/chatController.ts"] } } }))
    await put(root, settingsOwner, source)
    await assert.rejects(checkWorkspaceArchitecture(root), /the settings owner cannot import the coordinator, UI or entry points/)
  })
}

it("settings boundary: lint rejects erased type imports of the coordinator, UI, panels and entry points", async t => {
  const root = await settingsFixture(t)
  await put(root, ".oxlintrc.json", await readFile(join(workspace, ".oxlintrc.json"), "utf8"))
  for (const source of [
    'export type { ChatController } from "./chatController.ts"',
    'export type { ChatSurfaces } from "./chatSurfaces.ts"',
    'export type { activate } from "../extension.ts"',
    'export type { PanelInput } from "../panels/panelBroker.ts"',
    'export type { ChatSnapshot } from "@codem/ui/contract"',
    'export type { ExtensionContext } from "vscode"',
  ]) {
    await put(root, settingsOwner, source)
    assert.throws(() => execFileSync(join(workspace, "node_modules/.bin/oxlint"), ["--deny-warnings", settingsOwner], { cwd: root, encoding: "utf8", stdio: "pipe" }), error => {
      const failure = error as Error & { status: number; stdout: string }
      assert.equal(failure.status, 1, source)
      assert.match(failure.stdout, /no-restricted-imports/, source)
      return true
    })
  }
})

/** Runs the workspace Oxlint configuration on one fixture file; a zero status means the file passes. */
function lint(root: string, file: string): { status: number; stdout: string } {
  try {
    return { status: 0, stdout: execFileSync(join(workspace, "node_modules/.bin/oxlint"), ["--deny-warnings", file], { cwd: root, encoding: "utf8", stdio: "pipe" }) }
  } catch (error) {
    const failure = error as Error & { status: number; stdout: string }
    return { status: failure.status, stdout: failure.stdout }
  }
}

/** The three production entries, each importing a feature, as the real entries do. */
async function entryFixture(t: TestContext): Promise<string> {
  const root = await fixture(t)
  for (const [path, source] of [
    ["src/extension.ts", 'import { route } from "./chat/router.ts"; export function activate() { route() }'],
    ["src/nativeChat/nativeChatExtension.ts", 'import { route } from "../chat/router.ts"; export function activate() { route() }'],
    ["src/chat/router.ts", "export function route() {}"],
    ["webview/main.ts", 'import { bridge } from "./host/bridge.ts"; export const mounted = bridge'],
    ["webview/host/bridge.ts", "export const bridge = 1"],
  ] as const) await put(root, `apps/vscode/${path}`, source)
  await put(root, ".oxlintrc.json", await readFile(join(workspace, ".oxlintrc.json"), "utf8"))
  return root
}

it("entry boundary: entries may import features", async t => {
  await checkWorkspaceArchitecture(await entryFixture(t))
})

for (const [importer, source] of [
  ["src/chat/router.ts", 'export { activate } from "../extension.ts"'],
  ["src/chat/router.ts", 'export { activate } from "@entry"'],
  ["src/chat/router.ts", 'export const load = () => import("../nativeChat/nativeChatExtension.ts")'],
  ["src/nativeChat/nativeChatExtension.ts", 'export { activate } from "../extension.ts"'],
  ["webview/host/bridge.ts", 'export { mounted } from "../main.ts"'],
] as const) {
  it(`entry boundary: rejects ${importer} reaching an entry through ${source}`, async t => {
    const root = await entryFixture(t)
    await put(root, "apps/vscode/tsconfig.json", JSON.stringify({ compilerOptions: { paths: { "@entry": ["./src/extension.ts"] } } }))
    await put(root, `apps/vscode/${importer}`, source)
    await assert.rejects(checkWorkspaceArchitecture(root), /production modules cannot import an application entry/)
  })
}

it("entry boundary: lint rejects erased type imports of a Host entry and accepts similarly named modules", async t => {
  const root = await entryFixture(t)
  const file = "apps/vscode/src/chat/router.ts"
  await put(root, file, 'export type { NativeChatApi } from "../nativeChat/nativeChatApi.ts"; export type { Host } from "./extensionHost.ts"; export type { Smoke } from "../extensionSmoke"')
  assert.equal(lint(root, file).status, 0, "Modules named like an entry are not entries")
  for (const source of [
    'export type { activate } from "../extension.ts"',
    'export type { activate } from "../../src/extension"',
    'export type { activate } from "../nativeChat/nativeChatExtension.ts"',
  ]) {
    await put(root, file, source)
    const result = lint(root, file)
    assert.equal(result.status, 1, source)
    assert.match(result.stdout, /no-restricted-imports/, source)
  }
  // Owners with their own import rules replace this one, so each of them lists both Host entries too.
  for (const owner of ["apps/vscode/src/chat/backgroundTasks.ts", "apps/vscode/src/chat/chatSettings.ts"]) {
    await put(root, owner, 'export type { activate } from "../nativeChat/nativeChatExtension.ts"')
    const result = lint(root, owner)
    assert.equal(result.status, 1, owner)
    assert.match(result.stdout, /no-restricted-imports/, owner)
  }
})

/** Straight-line assembly: construction, wiring closures, disposal. */
const assembly = (statement: string) => `import * as vscode from "vscode"
const deactivations = new Set<() => Promise<unknown>>()
export function activate(context: { subscriptions: { dispose(): unknown }[]; extra?: { show(): void } }): void {
  const output = vscode.window.createOutputChannel("CodeM")
  const log = (line: string) => output.appendLine(line)
  ${statement}
  context.subscriptions.push(output, { dispose: () => { log("closed") } })
  deactivations.add(async () => undefined)
}
export async function deactivate(): Promise<void> {
  const pending = [...deactivations]
  deactivations.clear()
  await Promise.all(pending.map(dispose => dispose()))
}
`

it("entry shape: the extension entry lints clean as straight-line assembly", async t => {
  const root = await entryFixture(t)
  await put(root, "apps/vscode/src/extension.ts", assembly('log(String(context.subscriptions.length))'))
  assert.equal(lint(root, "apps/vscode/src/extension.ts").status, 0)
  await put(root, "apps/vscode/src/chat/router.ts", 'export function route(ready: boolean) { if (ready) return 1; return ready ? 2 : 3 }')
  assert.equal(lint(root, "apps/vscode/src/chat/router.ts").status, 0, "Feature modules own decisions")
})

for (const [kind, statement] of [
  ["an if statement", 'if (context.subscriptions.length) log("some")'],
  ["a conditional expression", 'log(context.subscriptions.length ? "some" : "none")'],
  ["optional chaining", "context.extra?.show()"],
  ["nullish coalescing", 'log(process.env.CODEM ?? "default")'],
  ["a logical operator", 'log(String(context.subscriptions.length > 0 && "some"))'],
  ["a switch", 'switch (context.subscriptions.length) { case 0: log("none") }'],
  ["a try/catch", 'try { log("try") } catch { log("catch") }'],
  ["a loop", "for (const item of context.subscriptions) item.dispose()"],
  ["a default parameter", 'const open = (target = "last") => log(target); open()'],
  ["a decision inside a wiring closure", 'const report = (error: unknown) => log(error instanceof Error ? error.message : "failed"); report(null)'],
] as const) {
  it(`entry shape: lint rejects ${kind} in the extension entry`, async t => {
    const root = await entryFixture(t)
    await put(root, "apps/vscode/src/extension.ts", assembly(statement))
    const result = lint(root, "apps/vscode/src/extension.ts")
    assert.equal(result.status, 1, statement)
    assert.match(result.stdout, /complexity/, statement)
  })
}
