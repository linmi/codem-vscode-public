import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as vscode from "vscode"
import { NativeFeatures } from "../src/nativeFeatures.ts"

export async function runNativeFeatureSmoke(): Promise<void> {
  const changed = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>()
  const values = new Map<string, string>()
  const secrets: vscode.SecretStorage = { get: async (key) => values.get(key), store: async (key, value) => { values.set(key, value) }, delete: async (key) => { values.delete(key) }, onDidChange: changed.event, keys: async () => [...values.keys()] }
  const native = new NativeFeatures(secrets)
  const root = await mkdtemp(join(tmpdir(), "codemNative"))
  try {
    assert.deepEqual(await native.loadMcp(), [])
    values.set("codem.mcp.v1", JSON.stringify({ servers: [{ type: "stdio", name: "test", command: process.execPath, args: [], env: [{ name: "TOKEN", value: "fixture-only" }] }], enabled: ["test"] }))
    assert.equal((await native.loadMcp())[0]?.env[0]?.value, "fixture-only")
    await native.showDiff({ source: { kind: "tool", toolCallId: "fixture" }, path: join(root, "file.txt"), changeType: "new", stats: { linesAdded: 1, linesRemoved: 0 }, preview: { kind: "complete", hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 1, lines: [{ kind: "insert", oldLine: null, newLine: 1, text: "fixture diff" }] }] } }, root)
    assert.equal(vscode.window.activeTextEditor?.document.uri.scheme, "codem-preview")
    assert.match(vscode.window.activeTextEditor!.document.getText(), /\+fixture diff/)
    const log = join(root, "log.txt")
    await writeFile(log, "x".repeat(300_000) + "TAIL_MARKER")
    await native.showLog(log)
    assert.match(vscode.window.activeTextEditor!.document.getText(), /仅显示最后 256 KiB/)
    assert.ok(vscode.window.activeTextEditor!.document.getText().endsWith("TAIL_MARKER"))
    assert.ok(vscode.window.activeTextEditor!.document.getText().length < 263_000)
    console.log("CODEM_NATIVE_FEATURES_OK: SecretStorage configuration adapter, readonly diff, bounded log preview")
  } finally { native.dispose(); changed.dispose(); await rm(root, { recursive: true, force: true }) }
}
