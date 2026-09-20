import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { realpath } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { resolveSessionsRoot } from "@codem/session-history"
import { ChatController, type ChatSession } from "../src/chatController.ts"
import { historyMessages } from "../src/historyMessages.ts"
import { timelineGroups } from "../src/timelineGroups.ts"
import { liveRuntime } from "./liveRuntime.ts"

/** Opt-in real Core regression: concurrent workspace changes must not trigger another answer. */
export async function runLiveReplyDelivery(extensionRoot: string, workspace: string): Promise<void> {
  const cwd = await realpath(workspace)
  const note = join(cwd, "externalNote.md")
  const readme = "Reply delivery fixture. Project goal: keep the original overview visible.\n"
  writeFileSync(join(cwd, "README.md"), readme)
  writeFileSync(note, "Existing project note.\n")
  const git = (args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  git(["init"])
  git(["add", "README.md", "externalNote.md"])
  git(["-c", "user.name=CodeM Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-m", "Initialize disposable reply fixture"])
  let session: ChatSession | null = null
  let changed = false
  let connections = 0
  const failures: string[] = []
  const outcomes: string[] = []
  const toolNames = new Set<string>()
  const controller = new ChatController({
    connect: async (_signIn, signal) => {
      connections++
      const connected = await liveRuntime(extensionRoot, cwd, signal)
      session = connected
      connected.host.onEvent(event => {
        if (event.type === "protocol-error") failures.push(event.message)
        if (event.type === "connection-closed" && !event.exit.expected) failures.push("Unexpected Core exit")
        if (event.type === "turn-completed") outcomes.push(event.outcome)
        if (event.type === "item-completed" && event.item.toolName) {
          toolNames.add(event.item.toolName)
          // Reproduce another actor changing a tracked file while a read-only answer runs.
          if (!changed) { writeFileSync(note, "Concurrent edit owned by another actor.\n"); changed = true }
        }
      })
      return connected
    },
    assertTrusted() {}, publish() {},
    report(operation, error) { failures.push(`${operation}: ${String(error)}`) },
    interact: async request => {
      assert.equal(request.kind, "permission")
      assert.equal(request.preview.kind, "bash_command")
      assert.equal(request.preview.command.trim(), "git status --short")
      assert.ok(request.options.some(option => option.id === "allow_once"))
      return { kind: "permission", optionId: "allow_once" }
    },
  })
  async function send(prompt: string) {
    assert.equal(await controller.send(prompt), true)
    const deadline = Date.now() + 90_000
    while (!["ready", "disconnected"].includes(controller.snapshot().phase) && Date.now() < deadline) await delay(50)
    assert.equal(controller.snapshot().phase, "ready", failures.join("\n"))
    assert.equal(outcomes.at(-1), "completed")
  }
  try {
    await controller.connect()
    assert.ok(session)
    const connected: ChatSession = session
    await send("这是只读项目总览验收。请读取 README.md，并调用 run_bash 执行准确命令 git status --short，然后用中文概括项目目标，正文末尾加 CODEM_OVERVIEW_OK。不要修改、清理或还原任何文件，不要执行其他命令。")
    assert.ok(changed, "The test must exercise real tools and a concurrent workspace edit")
    assert.ok(toolNames.has("run_bash"))
    const threadId = controller.snapshot().threadId!
    const recordPath = join(resolveSessionsRoot(process.env), createHash("sha256").update(cwd).digest("hex").slice(0, 16), `${threadId}.jsonl`)
    const records = readFileSync(recordPath, "utf8").trim().split("\n").map(line => JSON.parse(line))
    const checks = records.filter(record => record.type === "user_message" && record.origin === "synthetic" && record.content.includes("自检"))
    console.log(`REPLY_DELIVERY_OVERVIEW ${JSON.stringify({ checks: checks.length, tools: [...toolNames], assistantItems: controller.snapshot().messages.filter(message => message.role === "assistant").map(message => ({ id: message.id, overview: message.text.includes("CODEM_OVERVIEW_OK") })) })}`)
    assert.equal(checks.length, 0, "Core must not inject completion self-checks after the original answer")
    assert.ok(timelineGroups(controller.snapshot().messages).some(group => group.kind === "message" && group.message.role === "assistant" && group.message.text.includes("CODEM_OVERVIEW_OK")), "The overview must be visible outside the work disclosure")
    assert.equal(readFileSync(note, "utf8"), "Concurrent edit owned by another actor.\n")
    assert.equal(readFileSync(join(cwd, "README.md"), "utf8"), readme)
    await send("只回复 CODEM_FOLLOWUP_OK，不要调用工具。")
    assert.equal(controller.snapshot().threadId, threadId)
    const finishedRecords = readFileSync(recordPath, "utf8").trim().split("\n").map(line => JSON.parse(line))
    assert.equal(finishedRecords.filter(record => record.type === "user_message" && record.origin === "synthetic" && record.content.includes("自检")).length, 0, "Follow-up requests must also finish without synthetic self-checks")
    const page = await connected.readHistory(threadId, undefined, new AbortController().signal)
    const restored = timelineGroups(historyMessages(threadId, page))
    const live = timelineGroups(controller.snapshot().messages)
    for (const [source, groups] of [["live", live], ["history", restored]] as const) {
      const last = groups.at(-1)
      assert.ok(last?.kind === "message" && last.message.role === "assistant" && last.message.text.includes("CODEM_FOLLOWUP_OK"), `${source}: reasoning must not trail the completed answer`)
    }
    for (const marker of ["CODEM_OVERVIEW_OK", "CODEM_FOLLOWUP_OK"]) {
      assert.ok(restored.some(group => group.kind === "message" && group.message.role === "assistant" && group.message.text.includes(marker)), `History must retain ${marker} as a visible answer`)
    }
    assert.equal(connections, 1)
    assert.deepEqual(outcomes, ["completed", "completed"])
    assert.deepEqual(failures, [])
    console.log("CODEM_LIVE_REPLY_DELIVERY_OK")
  } finally { await controller.dispose() }
}
