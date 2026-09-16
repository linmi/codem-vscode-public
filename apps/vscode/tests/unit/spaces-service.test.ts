import { afterEach, beforeEach, expect, mock, test } from "bun:test"

const actual = await import("@codem/app-server")
class Emitter<T> {
  listeners = new Set<(value: T) => void>()
  event = (listener: (value: T) => void) => {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }
  fire(value: T) {
    for (const listener of this.listeners) listener(value)
  }
  dispose() {
    this.listeners.clear()
  }
}
const events: string[] = []
let prepareFailure = false
let preflightFailure = false
let commitFailure = false
let pendingPrepare: Promise<void> | null = null
let pendingModels: Promise<void> | null = null
const hosts: FakeHost[] = []
class FakeHost {
  hasActiveWork = false
  closed = false
  emitter = new Emitter<any>()
  constructor(readonly options: any) {
    hosts.push(this)
  }
  onEvent = this.emitter.event
  async prepareConnection(cwd: string) {
    events.push("preflight")
    if (preflightFailure) throw new Error("preflight failed")
    await this.options.prepareSpace(cwd)
  }
  async listModels() {
    events.push("models")
    await pendingModels
    return { activeModel: "codem-router/auto", models: [{ id: "codem-router/auto" }] }
  }
  async listSkills() {
    events.push("skills")
    return []
  }
  async startThread() {
    return "thread-1"
  }
  async close() {
    this.closed = true
    events.push("close")
  }
}
mock.module("vscode", () => ({
  EventEmitter: Emitter,
  window: { createOutputChannel: () => ({ append() {}, error() {}, dispose() {} }) },
  workspace: { isTrusted: true, getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
}))
mock.module("@codem/app-server", () => ({
  ...actual,
  AppServerHost: FakeHost,
  resolveBundledAppServerRuntime: () => ({}),
  listAppServerSpaces: async () => ({
    current: "proj_a",
    spaces: [
      { projectKey: "proj_a", displayName: "A" },
      { projectKey: "proj_b", displayName: "B" },
    ],
  }),
  prepareAppServerSpace: async (options: any, projectKey: string) => {
    events.push("prepare")
    await pendingPrepare
    options.signal.throwIfAborted()
    if (prepareFailure) throw new Error("prepare failed")
    return { projectKey, displayName: projectKey, managedDirectory: "/host/private" }
  },
  commitAppServerSpace: async () => {
    events.push("commit")
    if (commitFailure) throw new Error("commit failed")
  },
}))
const { CodeMAppServerService } = await import("../../src/services/app-server/service")
let service: InstanceType<typeof CodeMAppServerService>
let authEvents: Emitter<any>
beforeEach(() => {
  hosts.length = 0
  events.length = 0
  prepareFailure = preflightFailure = commitFailure = false
  pendingPrepare = pendingModels = null
  authEvents = new Emitter()
  service = new CodeMAppServerService(
    { extensionPath: "/extension", extension: { packageJSON: { version: "1" } } } as never,
    {
      current: null,
      onDidChange: authEvents.event,
      requireAuthenticated: async () => {},
      refresh: async () => {},
    } as never,
  )
})
afterEach(() => service.dispose())

test("space preparation and preflight precede commit; only DTO is published after retirement", async () => {
  const selected: unknown[] = []
  service.onDidChangeSpace((space) => selected.push(space))
  await service.selectSpace("/workspace", "proj_b")
  expect(events).toEqual(["prepare", "preflight", "models", "skills", "commit", "close"])
  expect(hosts[0].closed).toBe(true)
  expect(hosts[1].closed).toBe(false)
  expect(selected).toEqual([{ projectKey: "proj_b", displayName: "proj_b" }])
  expect((await service.listSpaces("/workspace")).current).toBe("proj_b")
})

test("preparation, launch and commit failures preserve previous selection and close candidates", async () => {
  for (const failure of ["prepare", "preflight", "commit"]) {
    prepareFailure = failure === "prepare"
    preflightFailure = failure === "preflight"
    commitFailure = failure === "commit"
    events.length = 0
    await expect(service.selectSpace("/workspace", "proj_b")).rejects.toThrow(`${failure} failed`)
    expect(hosts[0].closed).toBe(false)
    if (failure !== "commit") expect(events).not.toContain("commit")
    expect(hosts.slice(1).every((host) => host.closed)).toBe(true)
  }
  prepareFailure = preflightFailure = commitFailure = false
  await service.selectSpace("/workspace", "proj_b")
})

test("active work and in-flight requests exclude selection; selection excludes new work", async () => {
  hosts[0].hasActiveWork = true
  await expect(service.selectSpace("/workspace", "proj_b")).rejects.toThrow("finish before switching")
  hosts[0].hasActiveWork = false
  let release!: () => void
  pendingModels = new Promise((resolve) => {
    release = resolve
  })
  const reading = service.listModels("/workspace")
  await expect(service.selectSpace("/workspace", "proj_b")).rejects.toThrow("finish before switching")
  release()
  await reading
  pendingModels = null
  pendingPrepare = new Promise((resolve) => {
    release = resolve
  })
  const switching = service.selectSpace("/workspace", "proj_b")
  await expect(service.startThread("/workspace")).rejects.toThrow("switching spaces")
  await expect(service.selectSpace("/workspace", "proj_a")).rejects.toThrow("finish before switching")
  release()
  await switching
})

test("logout retires an in-flight prepared selection without publishing or committing it", async () => {
  let release!: () => void
  pendingPrepare = new Promise((resolve) => {
    release = resolve
  })
  const selected: unknown[] = []
  service.onDidChangeSpace((space) => selected.push(space))
  const switching = service.selectSpace("/workspace", "proj_b")
  authEvents.fire({ loggedIn: false })
  release()
  await expect(switching).rejects.toThrow()
  expect(events).not.toContain("commit")
  expect(selected).toEqual([null])
})

test("account replacement invalidates a pending selection even when both accounts are signed in", async () => {
  authEvents.fire({
    loggedIn: true,
    routerCredential: true,
    serverUrl: "https://codem.test",
    tenantId: "t",
    userId: "a",
  })
  let release!: () => void
  pendingPrepare = new Promise((resolve) => {
    release = resolve
  })
  const switching = service.selectSpace("/workspace", "proj_b")
  authEvents.fire({
    loggedIn: true,
    routerCredential: true,
    serverUrl: "https://codem.test",
    tenantId: "t",
    userId: "b",
  })
  release()
  await expect(switching).rejects.toThrow()
  expect(events).not.toContain("commit")
  expect(hosts[0].closed).toBe(true)
})

test("work becoming active during preparation prevents committing the selection", async () => {
  let release!: () => void
  pendingPrepare = new Promise((resolve) => {
    release = resolve
  })
  const switching = service.selectSpace("/workspace", "proj_b")
  hosts[0].hasActiveWork = true
  release()
  await expect(switching).rejects.toThrow("became active")
  expect(events).not.toContain("commit")
  expect(hosts[0].closed).toBe(false)
  expect(hosts[1].closed).toBe(true)
})
