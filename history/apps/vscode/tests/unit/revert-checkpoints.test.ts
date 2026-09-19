import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const TURN_FILE = path.join(ROOT, "webview-ui/src/components/chat/TranscriptRow.tsx")
const PROVIDER_FILE = path.join(ROOT, "src/CodeMProvider.ts")
const BANNER_FILE = path.join(ROOT, "webview-ui/src/components/chat/RevertBanner.tsx")
const SESSION_FILE = path.join(ROOT, "webview-ui/src/types/messages/sessions.ts")
const SDK_FILE = path.join(ROOT, "../../packages/sdk/js/src/v2/gen/types.gen.ts")

const src = fs.readFileSync(TURN_FILE, "utf-8")
const provider = fs.readFileSync(PROVIDER_FILE, "utf-8")
const banner = fs.readFileSync(BANNER_FILE, "utf-8")
const session = fs.readFileSync(SESSION_FILE, "utf-8")
const sdk = fs.readFileSync(SDK_FILE, "utf-8")

function exported(name: string) {
  const start = sdk.indexOf(`export type ${name} = {`)
  const end = sdk.indexOf("\nexport type ", start + 1)
  expect(start).toBeGreaterThan(-1)
  return sdk.slice(start, end === -1 ? undefined : end)
}

describe("message revert checkpoints", () => {
  it("keeps revert actions available after a session is already reverted", () => {
    expect(src).toMatch(/onRevert=\{\s*row\(\)\.answered\s*\? \(\) =>/)
    expect(src).not.toMatch(/onRevert=\{[\s\S]*?&& !session\.revert\(\)[\s\S]*?\? \(\) =>/)
  })

  it("only marks revert disabled while the agent is busy", () => {
    expect(src).toMatch(/data-revert-disabled=\{\s*row\(\)\.answered && session\.status\(\) !== "idle"/)
    expect(src).not.toMatch(/data-revert-disabled=\{[\s\S]*?!session\.revert\(\)/)
  })
})

describe("revert session synchronization", () => {
  it("does not keep leftover message-scoped revert handlers", () => {
    expect(provider).not.toContain("private async handleRevertSession")
    expect(provider).not.toContain("private async handleUnrevertSession")
    expect(provider).not.toContain("this.client.session.revert")
    expect(provider).not.toContain("this.client.session.unrevert")
  })

  it("uses ordered sync snapshots instead of duplicate bus snapshots", () => {
    expect(provider).toMatch(/source: "sync"/)
    expect(provider).toMatch(
      /if \(event\.type === "session\.updated"\) return "source" in event && event\.source === "sync"/,
    )
    expect(provider).toMatch(/if \(!isLegacySyncEvent\(event\)\) return/)
    expect(provider).toMatch(/this\.setCurrentSession\(event\.properties\.info\)/)
  })
})

describe("revert workspace restoration status", () => {
  it("renders explicit conversation-only outcomes", () => {
    expect(session).toContain('workspace?: "restored" | "snapshots-disabled" | "unavailable"')
    expect(exported("Session")).toContain('workspace?: "restored" | "snapshots-disabled" | "unavailable"')
    expect(exported("KilocodeSessionImportSessionData")).toContain(
      'workspace?: "restored" | "snapshots-disabled" | "unavailable"',
    )
    expect(banner).toContain('"revert.banner.workspace.snapshotsDisabled"')
    expect(banner).toContain('"revert.banner.workspace.unavailable"')
  })

  it("opens the checkpoints settings tab when snapshots are disabled", () => {
    expect(banner).toContain('{ type: "openSettingsPanel", tab: "checkpoints" }')
    expect(banner).toContain('"revert.banner.workspace.enableSnapshots"')
  })

  it("uses a legacy notice for reverts without an explicit outcome", () => {
    expect(banner).toContain('"revert.banner.workspace.legacy"')
  })
})
