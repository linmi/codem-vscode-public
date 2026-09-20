import { AppServerHost, resolveBundledAppServerRuntime } from "@codem/app-server"
import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ChatController, type ChatSession } from "../src/chatController.ts"
import { liveRuntime } from "./liveRuntime.ts"

/** Explicit real-model acceptance, confined to a disposable workspace. */
export async function runLiveCapabilities(extensionRoot: string, workspace: string, compactOnly = false): Promise<void> {
  const skillRoot = join(workspace, ".agents", "skills", "codem-capability-fixture")
  await mkdir(skillRoot, { recursive: true })
  await writeFile(join(skillRoot, "SKILL.md"), "---\nname: codem-capability-fixture\ndescription: Explicit client capability acceptance fixture.\n---\nReply with CODEM_SKILL_OK. Do not call tools or read or modify files.\n")
  let session: ChatSession | null = null
  let rewindSelections = 0
  const events: string[] = []
  const created = new Set<string>()
  const stages: Record<string, number> = {}
  const failures: unknown[] = []
  const controller = new ChatController({
    connect: async (_signIn, signal) => {
      const connected = await liveRuntime(extensionRoot, workspace, signal)
      session = connected
      connected.host.onEvent(event => { events.push(event.type); if (event.type === "thread-started") created.add(event.threadId); if (event.type === "warning") console.log(`CORE_WARNING ${event.message.replace(/https?:\/\/\S+/g, "[url]").slice(0, 250)}`); if (event.type === "protocol-error") console.log(`CORE_PROTOCOL_VALIDATION ${event.message.slice(0, 250)}`) })
      return connected
    },
    assertTrusted() {}, publish() {},
    interact: async request => {
      if (request.kind === "rewind") {
        rewindSelections++
        assert.ok(request.modes.includes("conversation"))
        return { kind: "rewind", cancelled: false, mode: "conversation", checkpointId: request.checkpoints[0]!.id }
      }
      throw new Error(`Unexpected live fixture interaction: ${request.kind}`)
    },
    report: (operation, error) => console.log(`CAPABILITY_OPERATION_FAILED ${operation}: ${error instanceof Error ? error.message : "unknown"}`),
  })
  async function settle(label: string) {
    const started = performance.now()
    while (!["ready", "disconnected"].includes(controller.snapshot().phase) && performance.now() - started < (label === "compact" ? 20_000 : 90_000)) await new Promise(resolve => setTimeout(resolve, 50))
    stages[label] = Math.round(performance.now() - started)
    console.log(`CAPABILITY_STAGE ${label} ${controller.snapshot().phase} ${stages[label]}ms`)
    assert.equal(controller.snapshot().phase, "ready", `${label}: ${controller.snapshot().notice}`)
  }
  try {
    await controller.connect(); assert.equal(controller.snapshot().phase, "ready", controller.snapshot().notice ?? "connect failed")
    assert.ok(session)
    const connected: ChatSession = session
    await controller.configure(async settings => ({ ...settings, intelligence: "low", permissionMode: "auto" }))
    await controller.loadCatalog("skills")
    const skill = controller.snapshot().sessionTools.skills.find(item => item.name === "codem-capability-fixture")
    assert.ok(skill, "Core must discover the local fixture skill")
    controller.selectSkill(skill.id)
    assert.equal(await controller.send("只回复 CODEM_SKILL_OK。"), true)
    await settle("skill")
    assert.ok(controller.snapshot().messages.some(message => message.role === "assistant" && message.text.includes("CODEM_SKILL_OK")), "Native skill input must reach model")
    const threadId = controller.snapshot().threadId!
    if (!compactOnly) {
    await controller.askSideQuestion("只回复 CODEM_SIDE_OK，不要调用工具。", "side-acceptance")
    await settle("side")
    assert.equal(controller.snapshot().sessionTools.sideQuestion?.status, "completed")
    assert.match(controller.snapshot().sessionTools.sideQuestion?.answer ?? "", /CODEM_SIDE_OK/)
    assert.equal(await controller.send("这是临时工作区验收。请用文件写入工具新建 capability-result.txt，内容 CODEM_REWIND_FIXTURE，然后用 200 字解释 TypeScript 类型收窄。不要执行其他操作。"), true)
    if (controller.snapshot().phase === "running") await controller.steer("最后加上 CODEM_STEER_OK。", "steer-acceptance")
    await settle("steer")
    assert.equal(controller.snapshot().sessionTools.result?.requestId, "steer-acceptance")
    assert.equal(controller.snapshot().sessionTools.result?.accepted, true)
    await controller.startControl("rewind", "rewind-acceptance")
    await settle("rewind")
    assert.ok(rewindSelections > 0, "Real rewind must offer checkpoint selection")
    }
    await controller.startControl("compact", "compact-acceptance")
    try { await settle("compact") }
    catch (error) {
      failures.push(error)
      console.log("CORE_COMPACT_TERMINAL_MISSING: interrupting explicitly; this is a failed success-path check")
      await controller.stop(); await settle("compactInterrupt")
    }
    await controller.shellCommand("printf CODEM_SHELL_OK > capability-shell.txt", "shell-acceptance")
    await settle("shell")
    const shellDeadline = Date.now() + 5_000
    let shellOutput = ""
    while (Date.now() < shellDeadline) {
      try { shellOutput = await readFile(join(workspace, "capability-shell.txt"), "utf8"); break }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (shellOutput !== "CODEM_SHELL_OK") { failures.push(new Error("Core shellCommand acknowledged but did not create its output file")); console.log("CORE_SHELL_EFFECT_MISSING") }
    assert.equal(controller.snapshot().sessionTools.result?.accepted, true)
    for (const kind of ["environment", "config", "hooks", "plugins", "permissions", "spaces", "provider", "live"] as const) { await controller.loadCatalog(kind); assert.equal(controller.snapshot().sessionTools.catalog?.kind, kind) }
    await controller.manageThread("rename", threadId, "Capability acceptance", "rename-acceptance")
    assert.equal(controller.snapshot().sessionTools.result?.accepted, true)
    await controller.manageThread("clear", threadId, "", "clear-acceptance")
    assert.notEqual(controller.snapshot().threadId, threadId)
    assert.equal(controller.snapshot().messages.length, 0)
    const newId = controller.snapshot().threadId!
    await controller.manageThread("delete", newId, "", "delete-acceptance")
    await connected.host.control(connected.cwd, "thread/delete", { threadId })
    created.delete(threadId); created.delete(newId)
    console.log(`${failures.length ? "CODEM_LIVE_CAPABILITIES_PARTIAL" : "CODEM_LIVE_CAPABILITIES_OK"} ${JSON.stringify({ stages, events: [...new Set(events)] })}`)
    if (failures.length) throw new AggregateError(failures, "Core capability success paths remain incomplete")
  } finally {
    await controller.dispose()
    const cleanup = new AppServerHost({ runtime: resolveBundledAppServerRuntime({ extensionRoot }), clientInfo: { name: "codem-fixture-cleanup", version: "1" }, assertAuthenticated() {} })
    try { for (const threadId of created) await cleanup.control(workspace, "thread/delete", { threadId }) }
    finally { await cleanup.close() }
  }
}
