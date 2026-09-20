import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  isAppServerKnownNotification,
  parseAppServerConfigSnapshot,
  parseAppServerCoreSpaceSnapshot,
  parseAppServerEnvironmentInfo,
  parseAppServerLiveItems,
  parseAppServerPermissionProfiles,
  parseAppServerToolList,
  processIdValue,
  redactAppServerSecrets,
} from "../src/index.ts"

import { parseAppServerBackgroundTerminalList } from "../src/control-plane.ts"

describe("App Server control-plane projection", () => {
  it("projects Core alive into terminal state and rejects the obsolete wire inProgress field", () => {
    const terminal = { processId: 42, logPath: "/core/bg/log", alive: true, meta: { command: "sleep 60" } }
    assert.deepEqual(parseAppServerBackgroundTerminalList({ cwd: "/workspace", terminals: [terminal] }, "fixture"), { cwd: "/workspace", terminals: [{ processId: 42, logPath: "/core/bg/log", inProgress: true }] })
    assert.equal(parseAppServerBackgroundTerminalList({ cwd: "/workspace", terminals: [{ ...terminal, alive: false }] }, "fixture").terminals[0]?.inProgress, false)
    for (const invalid of [{ processId: 42, logPath: "/core/bg/log", inProgress: true }, { ...terminal, alive: "true" }, { ...terminal, alive: null }]) assert.throws(() => parseAppServerBackgroundTerminalList({ cwd: "/workspace", terminals: [invalid] }, "fixture"), /alive/)
  })
  it("redacts secret config keys and keeps neighboring fields", () => {
    assert.deepEqual(
      redactAppServerSecrets(
        {
          active: { model: "codem-router/auto" },
          custom: [{ apikey: "secret-value", api_key_env: "DEEPSEEK_API_KEY", model: "meego" }],
        },
        "config",
      ),
      {
        active: { model: "codem-router/auto" },
        custom: [{ apikey: null, api_key_env: "DEEPSEEK_API_KEY", model: "meego" }],
      },
    )
  })

  it("parses the live Core 0.8.44 control-plane shapes", () => {
    assert.deepEqual(
      parseAppServerEnvironmentInfo(
        {
          agent: { name: "codem", version: "0.8.44+1.gfixture" },
          arch: "aarch64",
          cwd: "/tmp/ws",
          os: "macos",
          shell: "/bin/zsh",
        },
        "environment/info",
      ),
      {
        agentName: "codem",
        agentVersion: "0.8.44+1.gfixture",
        arch: "aarch64",
        cwd: "/tmp/ws",
        os: "macos",
        shell: "/bin/zsh",
      },
    )
    const config = parseAppServerConfigSnapshot(
      {
        writable: false,
        writeOwner: "codem-bridge",
        config: { custom: [{ apikey: "cat_key" }] },
      },
      "config/read",
    )
    assert.equal(config.writable, false)
    assert.equal((config.config.custom as { apikey: null }[])[0].apikey, null)
    assert.deepEqual(
      parseAppServerPermissionProfiles(
        {
          profiles: [
            { id: "default", name: "Ask", description: "Ask", settableAtRuntime: true },
            { id: "auto", name: "Auto", description: "Review", settableAtRuntime: true },
          ],
        },
        "permissionProfile/list",
      ).map((profile) => profile.id),
      ["default", "auto"],
    )
    assert.deepEqual(parseAppServerCoreSpaceSnapshot({ current: null, spaces: [] }, "space/list"), {
      current: null,
      spaces: [],
    })
    assert.deepEqual(
      parseAppServerToolList(
        { threadId: "thread-1", model: "codem-router/auto", tools: ["read_files"] },
        "thread-1",
        "tools/list",
      ),
      { threadId: "thread-1", model: "codem-router/auto", tools: ["read_files"] },
    )
    assert.deepEqual(parseAppServerLiveItems({ items: [], nextCursor: null, total: 0 }, "thread/items/list"), {
      entries: [],
      nextCursor: null,
      total: 0,
    })
  })

  it("rejects malformed control-plane payloads instead of leaking them", () => {
    assert.throws(
      () => parseAppServerToolList({ threadId: "other", model: "x", tools: ["read_files"] }, "thread-1", "tools/list"),
      /expected thread-1/,
    )
    assert.throws(() => processIdValue(0, "processId"), /positive integer/)
    assert.throws(
      () => parseAppServerCoreSpaceSnapshot({ current: { projectKey: "missing", displayName: "X" }, spaces: [] }, "space/list"),
      /absent/,
    )
    assert.equal(isAppServerKnownNotification("turn/completed"), true)
    assert.equal(isAppServerKnownNotification("future/unknown"), false)
  })
})
