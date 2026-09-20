import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
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
  for (const name of ["app-server", "session-history", "protocol"]) {
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

it("architecture gate: accepts Node services, local protocol code and public package imports", async t => {
  const root = await fixture(t)
  await put(root, "packages/app-server/src/index.ts", 'export { join } from "node:path"; export { value } from "@codem/protocol"')
  await put(root, "packages/protocol/src/index.ts", 'export { value } from "./value.ts"')
  await put(root, "packages/protocol/src/value.ts", "export const value = 1")
  await checkWorkspaceArchitecture(root)
})

it("application boundaries: accepts shared contracts and UI composition", async t => {
  const root = await fixture(t)
  await put(root, "apps/vscode/src/shared/messages.ts", 'export { value } from "@codem/protocol"')
  await put(root, "apps/vscode/webview/components/ui/button.ts", "export const button = 1")
  await put(root, "apps/vscode/webview/composer/view.ts", 'export { value } from "../../src/shared/messages.ts"; export { button } from "../components/ui/button.ts"')
  await checkWorkspaceArchitecture(root)
})

for (const [importer, target, message] of [
  ["webview/composer/view.ts", "src/chat/controller.ts", "Webview cannot import Host implementation"],
  ["src/shared/messages.ts", "src/chat/controller.ts", "application contracts cannot depend on features"],
  ["webview/components/ui/button.ts", "webview/composer/view.ts", "base UI cannot depend on application features"],
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
    ["webview/panels/panel.ts", 'export type { ChatController } from "../../src/chat/chatController.ts"'],
    ["src/shared/messages.ts", 'export type { ChatController } from "../chat/chatController.ts"'],
    ["webview/components/ui/button.ts", 'export type { ComposerState } from "../../composer/composerState.ts"'],
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

for (const source of ['export { window } from "vscode"', 'export const load = () => import("electron")']) {
  it(`architecture gate: rejects platform dependency ${source}`, async t => {
    const root = await fixture(t)
    await put(root, "packages/app-server/src/index.ts", source)
    await assert.rejects(checkWorkspaceArchitecture(root), /cannot import an editor\/UI runtime/)
  })
}

it("architecture gate: rejects shared code reaching application internals", async t => {
  const root = await fixture(t)
  await put(root, "packages/session-history/src/index.ts", 'export { value } from "../../../apps/vscode/src/index.ts"')
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

it("structure gate: composer state accepts its contracts and rejects UI, Host, entrypoint and arbitrary helper imports", async t => {
  const root = await fixture(t)
  await put(root, ".oxlintrc.json", await readFile(join(workspace, ".oxlintrc.json"), "utf8"))
  const path = "apps/vscode/webview/composer/composerState.ts"
  const lint = () => execFileSync(join(workspace, "node_modules/.bin/oxlint"), ["--deny-warnings", path], { cwd: root, encoding: "utf8", stdio: "pipe" })
  await put(root, path, 'export type { ComposerDraft } from "../../src/shared/messages.ts"; export { ComposerSubmission } from "./composerSubmission.ts"')
  lint()
  for (const source of [
    'export { createComposerView } from "./composerView.ts"',
    'export type { ChatController } from "../../src/chat/chatController.ts"',
    'import "../main.ts"',
    'export type { ReactNode } from "react"',
    'export { readFile } from "node:fs/promises"',
    'export { draft } from "./helpers.ts"',
    'export const load = () => import("./composerView.ts")',
  ]) {
    await put(root, path, source)
    assert.throws(lint, error => {
      const failure = error as Error & { status: number; stdout: string }
      assert.equal(failure.status, 1)
      assert.match(failure.stdout, /no-restricted-imports/)
      return true
    }, source)
  }
})

it("structure gate: composer type environment accepts plain state and rejects DOM and ambient Node APIs", async t => {
  const root = await fixture(t)
  const directory = "apps/vscode/webview"
  const config = JSON.parse(await readFile(join(workspace, directory, "tsconfig.composer.json"), "utf8"))
  config.extends = join(workspace, "tsconfig.json")
  await put(root, `${directory}/tsconfig.composer.json`, JSON.stringify(config))
  const path = `${directory}/composer/composerState.ts`
  const check = () => execFileSync(join(workspace, "apps/vscode/node_modules/.bin/tsc"), ["--noEmit", "-p", `${directory}/tsconfig.composer.json`], { cwd: root, encoding: "utf8", stdio: "pipe" })
  await put(root, path, 'export const drafts = new Map<string, string>()')
  check()
  for (const source of ['export const draft = document.createElement("textarea")', 'export const draft = process.env.DRAFT']) {
    await put(root, path, source)
    assert.throws(check, error => {
      const failure = error as Error & { status: number; stdout: string }
      assert.notEqual(failure.status, 0)
      assert.match(failure.stdout, /Cannot find name '(document|process)'/)
      return true
    }, source)
  }
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
