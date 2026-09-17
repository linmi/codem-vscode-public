import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import {
  assertPermissionModeSettable,
  codemModelsLoadedMessage,
  codemSkillsLoadedMessage,
  copyBackgroundTerminals,
  copyConfigSnapshot,
  copyEnvironmentInfo,
  copyPluginList,
} from "../../../../src/services/app-server/codem-webview-dto.ts"

const hostDto = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../../src/services/app-server/codem-webview-dto.ts"),
  "utf8",
)

describe("CodeM webview catalog DTO", () => {
  it("copies only App Server model fields and does not emit providersLoaded", () => {
    const extra = {
      id: "codem-router/auto",
      source: "builtin",
      contextWindowTokens: 256000,
      supportsVision: false,
      secret: "do-not-leak",
    }
    const message = codemModelsLoadedMessage({
      activeModel: "codem-router/auto",
      models: [extra],
    })
    assert.equal(message.type, "codemModelsLoaded")
    assert.deepEqual(message.catalog.models[0], {
      id: "codem-router/auto",
      source: "builtin",
      contextWindowTokens: 256000,
      supportsVision: false,
    })
    assert.equal("secret" in (message.catalog.models[0] as object), false)
  })

  it("copies only skill name and description", () => {
    const extra = { name: "review", description: "Review code", location: "/tmp/skill", env: { KEY: "1" } }
    const message = codemSkillsLoadedMessage([extra])
    assert.deepEqual(message, {
      type: "codemSkillsLoaded",
      skills: [{ name: "review", description: "Review code" }],
    })
  })

  it("imports catalog types from @codem/protocol instead of declaring a parallel interface", () => {
    assert.match(hostDto, /from "@codem\/protocol"/)
    assert.doesNotMatch(hostDto, /export interface Codem(?:Model|Skill|Mode)/)
  })

  it("rejects only permission profiles that Core marks not settable", () => {
    assertPermissionModeSettable([], "yolo")
    assertPermissionModeSettable([{ id: "auto", name: "Auto", description: "", settableAtRuntime: true }], "auto")
    assert.throws(
      () =>
        assertPermissionModeSettable([{ id: "yolo", name: "Yolo", description: "", settableAtRuntime: false }], "yolo"),
      /not settable at runtime/,
    )
  })

  it("strips cwd, shell, plugin metadata, and terminal logPath before Webview copy", () => {
    assert.deepEqual(
      copyEnvironmentInfo({
        agentName: "codem",
        agentVersion: "0.8.37",
        arch: "arm64",
        cwd: "/workspace",
        os: "macos",
        shell: "/bin/zsh",
      }),
      { agentName: "codem", agentVersion: "0.8.37", os: "macos", arch: "arm64" },
    )
    assert.deepEqual(
      copyConfigSnapshot({
        writable: false,
        writeOwner: "core",
        config: { theme: "dark", cwd: "/workspace", home: "/Users/linmi", note: "ok" },
      }),
      { writable: false, writeOwner: "core", config: { theme: "dark", note: "ok" } },
    )
    assert.deepEqual(
      copyPluginList({
        installed: { review: { path: "/tmp/plugin" } },
        marketplaces: { official: { url: "https://example.test" } },
      }),
      { installed: ["review"], marketplaces: ["official"] },
    )
    assert.deepEqual(
      copyBackgroundTerminals({
        cwd: "/workspace",
        terminals: [{ processId: 3, logPath: "/tmp/term.log", inProgress: false }],
      }),
      { terminals: [{ processId: 3, inProgress: false }] },
    )
  })
})
