import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { it } from "node:test"
import { inhibitorCommand, KeepAwake, type KeepAwakeOptions, type KeepAwakePhase } from "../src/integrations/keepAwake.ts"

class FakeChild extends EventEmitter { killed = 0; kill(): boolean { this.killed++; return true } }

function harness(command: KeepAwakeOptions["command"] = { command: "inhibit", args: [] }) {
  const phases: KeepAwakePhase[] = []
  const failures: string[] = []
  const children: FakeChild[] = []
  const keepAwake = new KeepAwake({
    command,
    publish: phase => phases.push(phase),
    failed: message => failures.push(message),
    spawn: () => { const child = new FakeChild(); children.push(child); return child as unknown as ChildProcess },
  })
  return { keepAwake, phases, failures, children }
}

it("every supported inhibitor is tied to the host process and unsupported platforms have none", () => {
  for (const platform of ["darwin", "linux", "win32"] as const) {
    const command = inhibitorCommand(platform, 4242)
    assert.ok(command)
    assert.match(command.args.join(" "), /4242/)
  }
  assert.deepEqual(inhibitorCommand("darwin", 1)?.args, ["-i", "-w", "1"])
  assert.equal(inhibitorCommand("freebsd", 1), null)
})

it("toggles through starting and on, and turning off kills the only inhibitor", () => {
  const { keepAwake, phases, failures, children } = harness()
  keepAwake.toggle()
  keepAwake.enable()
  assert.equal(children.length, 1, "a repeated enable while starting does not spawn twice")
  children[0]!.emit("spawn")
  assert.equal(keepAwake.state, "on")
  keepAwake.toggle()
  assert.equal(children[0]!.killed, 1)
  // The exit that follows our own kill is not a failure.
  children[0]!.emit("exit", null)
  assert.deepEqual(phases, ["starting", "on", "off"])
  assert.deepEqual(failures, [])
})

it("an inhibitor that fails to start or stops by itself returns to off and says why", () => {
  const { keepAwake, phases, failures, children } = harness({ command: "systemd-inhibit", args: [] })
  keepAwake.enable()
  children[0]!.emit("error", Object.assign(new Error("spawn systemd-inhibit ENOENT"), { code: "ENOENT" }))
  children[0]!.emit("exit", -2)
  assert.equal(keepAwake.state, "off")
  assert.deepEqual(failures, ["无法开启防休眠：未找到 systemd-inhibit。"])
  keepAwake.enable()
  children[1]!.emit("spawn")
  children[1]!.emit("exit", 1)
  assert.deepEqual(phases, ["starting", "off", "starting", "on", "off"])
  assert.match(failures[1]!, /退出码 1/)
  // A late event from an old inhibitor never touches the current one.
  keepAwake.enable()
  children[0]!.emit("exit", 1)
  assert.equal(keepAwake.state, "starting")
  assert.equal(failures.length, 2)
})

it("unsupported platforms and dispose leave nothing running", () => {
  const unsupported = harness(null)
  unsupported.keepAwake.toggle()
  assert.equal(unsupported.keepAwake.supported, false)
  assert.deepEqual(unsupported.failures, ["当前系统不支持防休眠。"])
  assert.equal(unsupported.children.length, 0)
  const { keepAwake, children } = harness()
  keepAwake.enable()
  keepAwake.dispose()
  assert.equal(children[0]!.killed, 1)
  assert.equal(keepAwake.state, "off")
})

it("a real inhibitor process ends when keep-awake is turned off", async () => {
  let child: ChildProcess | undefined
  let resolveOn = () => {}, rejectOn: (error: Error) => void = () => {}
  const on = new Promise<void>((resolve, reject) => { resolveOn = resolve; rejectOn = reject })
  const keepAwake = new KeepAwake({
    command: { command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] },
    publish: phase => { if (phase === "on") resolveOn() },
    failed: message => rejectOn(new Error(message)),
    spawn: (command, args) => (child = spawn(command, args, { stdio: "ignore" })),
  })
  keepAwake.enable()
  await on
  const exited = new Promise(resolve => child!.once("exit", resolve))
  keepAwake.disable()
  await exited
  assert.ok(child!.exitCode !== null || child!.signalCode !== null)
})

it("the Linux inhibitor's held command ends by itself when the host process exits", { skip: process.platform !== "linux" }, async () => {
  const host = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
  const args = inhibitorCommand("linux", host.pid!)!.args
  const held = args.slice(args.indexOf("tail"))
  const waiter = spawn(held[0]!, held.slice(1), { stdio: "ignore" })
  await new Promise(resolve => waiter.once("spawn", resolve))
  const ended = new Promise<number | null>(resolve => waiter.once("exit", resolve))
  host.kill()
  assert.equal(await ended, 0)
})
