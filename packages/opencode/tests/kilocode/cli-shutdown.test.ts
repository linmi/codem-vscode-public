import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { KiloShutdown } from "../../src/kilocode/cli/shutdown"

const calls: string[] = []
let err: unknown
let drainCalls = 0
let exit: string | number | null | undefined

mock.module("@opencode-ai/core/global", () => ({
  Global: { Path: { data: "/tmp/kilo-test" } },
}))

mock.module("@opencode-ai/core/installation/version", () => ({
  InstallationBuildKind: "release",
  InstallationVersion: "test",
}))

mock.module("@kilocode/kilo-gateway", () => ({
  ENV_FEATURE: "KILO_FEATURE",
  ENV_VERSION: "KILO_VERSION",
  async migrateLegacyKiloAuth() {
    calls.push("auth:migrate")
  },
}))

mock.module("@/effect/app-runtime", () => ({
  AppRuntime: {
    async runPromise() {
      calls.push("runtime")
    },
    async dispose() {},
  },
}))

mock.module("@/kilocode/log", () => ({
  KiloLog: {
    async init() {
      calls.push("log")
    },
  },
}))

mock.module("@/kilocode/storage/json-migration", () => ({
  JsonMigration: {
    async bootstrap() {
      calls.push("migration")
    },
  },
}))

mock.module("@/config/config", () => ({
  Config: { Service: { use: () => ({ experimental: {} }) } },
}))

mock.module("@/auth", () => ({
  Auth: { Service: { use: () => undefined } },
}))

mock.module("@/project/instance-runtime", () => ({
  InstanceRuntime: {
    async disposeAllInstances() {
      calls.push("dispose")
    },
  },
}))

mock.module("@/kilocode/session-export", () => ({
  SessionExport: {
    async shutdown() {
      calls.push("session")
      if (err) throw err
    },
  },
}))

mock.module("@/kilocode/help-command", () => ({
  createHelpCommand: () => ({ command: "help", handler() {} }),
}))

for (const path of [
  "@/kilocode/cli/cmd/console",
  "@/kilocode/cli/cmd/cloud",
  "@/kilocode/cli/cmd/roll-call",
  "@/kilocode/cli/cmd/profile",
  "@/kilocode/cli/cmd/daemon",
  "@/kilocode/cli/dev-setup",
  "@/cli/cmd/remote",
  "@/cli/cmd/config",
]) {
  mock.module(path, () => ({
    KiloConsoleCommand: { command: "console", handler() {} },
    CloudCommand: { command: "cloud", handler() {} },
    RollCallCommand: { command: "roll-call", handler() {} },
    ProfileCommand: { command: "profile", handler() {} },
    DaemonCommand: { command: "daemon", handler() {} },
    DevSetupCommand: { command: "dev-setup", handler() {} },
    DevAliasCommand: { command: "dev-alias", handler() {} },
    RemoteCommand: { command: "remote", handler() {} },
    ConfigCommand: { command: "config", handler() {} },
  }))
}

/** Same mock body as the kilo-sessions module mock used by setup.ts's drain task. */
function registerDrain() {
  KiloShutdown.register(async () => {
    drainCalls += 1
    calls.push("drain")
  })
}

/**
 * Install a drain task for this test only. Clears any leftover registry entries first
 * (setup.ts's one-time module-scope registration, or a prior test) so assertions do not
 * depend on declaration order or on whether an earlier test already ran KiloShutdown.run().
 */
async function installDrain() {
  await KiloShutdown.run()
  calls.length = 0
  drainCalls = 0
  registerDrain()
}

describe("KiloCli.shutdown", () => {
  beforeEach(() => {
    calls.length = 0
    err = undefined
    drainCalls = 0
    exit = process.exitCode
    process.exitCode = undefined
  })

  afterEach(() => {
    process.exitCode = exit
  })

  test("does not load unused ingest shutdown work", async () => {
    process.exitCode = 0
    const { KiloCli } = await import("../../src/kilocode/cli/setup")

    await expect(KiloCli.shutdown()).resolves.toBeUndefined()

    expect(drainCalls).toBe(0)
    expect(calls).toEqual(["session", "dispose"])
    expect(process.exitCode).toBe(0)
  })

  test("disposes instances and drains when session export shutdown fails", async () => {
    err = new Error("Session export shutdown failed")
    process.exitCode = 0
    const { KiloCli } = await import("../../src/kilocode/cli/setup")
    await installDrain()

    await expect(KiloCli.shutdown()).rejects.toThrow("Session export shutdown failed")

    expect(calls).toEqual(["session", "drain", "dispose"])
    expect(process.exitCode).toBe(0)
  })

  test("preserves failing command exit status", async () => {
    process.exitCode = 1
    const { KiloCli } = await import("../../src/kilocode/cli/setup")
    await installDrain()

    await KiloCli.shutdown()

    expect(calls).toEqual(["session", "drain", "dispose"])
    expect(process.exitCode).toBe(1)
  })

  test("skips lifecycle work for parsed informational flags", async () => {
    const { KiloCli } = await import("../../src/kilocode/cli/setup")
    await installDrain()

    for (const flag of ["help", "version"] as const) {
      await KiloCli.bootstrap({ [flag]: true })
      await KiloCli.shutdown()
    }

    expect(calls).toEqual([])
  })
})
