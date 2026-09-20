import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ChatController, type ChatSession } from "../src/chat/chatController.ts"
import { assertTrusted, connectRuntime } from "../src/connection/runtimeSession.ts"
import type { ChatSnapshot } from "../src/shared/messages.ts"

/** Opt-in integration on the smoke runner's disposable workspace. Never use real MCP credentials. */
export async function runLiveFeatures(extensionRoot: string): Promise<void> {
  let session: ChatSession | null = null
  let resolveTurn: ((snapshot: ChatSnapshot) => void) | null = null
  const controller = new ChatController({
    connect: async (_signIn, signal) => {
      session = await connectRuntime(extensionRoot, "0.2.0", false, signal)
      return session
    },
    assertTrusted,
    publish: (snapshot) => { if (snapshot.messages.length && (snapshot.phase === "ready" || snapshot.phase === "disconnected")) resolveTurn?.(snapshot) },
    interact: async (request) => {
      // The fixture MCP only returns a constant. No unrelated execution is authorized by this test.
      if (request.kind === "permission" && ((request.preview.kind === "mcp" && request.preview.server === "codem_fixture") || (request.preview.kind === "file_write" && session && request.preview.path === join(session.cwd, "feature-result.txt")) || (request.preview.kind === "bash_command" && request.preview.command.trim() === "sleep 60"))) {
        const option = request.options.find((option) => option.id === "allow_once")
        if (option) return { kind: "permission", optionId: option.id }
      }
      throw new Error("Unexpected live feature test approval")
    },
    report: (operation) => console.log(`CodeM live feature failure: ${operation}`),
  })
  async function turn(text: string): Promise<ChatSnapshot> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const result = new Promise<ChatSnapshot>((resolve) => { resolveTurn = resolve })
    try {
      const sent = controller.send(text).then(() => result)
      const state = await Promise.race([sent, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Live feature turn exceeded 120 seconds")), 120_000) })])
      assert.equal(state.phase, "ready", state.notice ?? "Expected ready phase")
      assert.equal(state.notice, null)
      return state
    } finally { clearTimeout(timer); resolveTurn = null }
  }
  try {
    await controller.connect()
    assert.equal(controller.snapshot().phase, "ready", controller.snapshot().notice ?? "Connection failed")
    assert.ok(session)
    const connected: ChatSession = session
    if (process.env.CODEM_RESOURCES_ONLY !== "1") {
    const attachment = join(connected.cwd, "feature-input.txt")
    await writeFile(attachment, "验证标记：CODEM_ATTACHMENT_OK\n")
    await controller.addAttachments(async () => [{ kind: "file", path: attachment }])
    await controller.configure(async (settings) => ({ ...settings, intelligence: "low" }))
    const first = await turn("这是附件集成测试。只回复附件中的验证标记，不要读取或修改其他文件，不要调用任何外部工具。")
    assert.ok(first.messages.some((message) => message.role === "assistant" && message.text.includes("CODEM_ATTACHMENT_OK")), "Core must receive attachment content")
    assert.equal(first.attachments.length, 0)
    const script = join(connected.cwd, "mcpFixture.cjs")
    const trace = join(connected.cwd, "mcpFixture.log")
    await writeFile(script, `const fs=require('node:fs');const trace=${JSON.stringify(trace)};fs.appendFileSync(trace,'started\\n');const readline=require('node:readline');readline.createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);fs.appendFileSync(trace,q.method+'\\n');if(q.id===undefined)return;let result;if(q.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};else if(q.method==='tools/list')result={tools:[{name:'echo',description:'Return the integration fixture marker',inputSchema:{type:'object',properties:{}}}]};else if(q.method==='tools/call')result={content:[{type:'text',text:'CODEM_MCP_OK'}]};else result={};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n')});`)
    const otherModel = connected.models.find((model) => model.id !== connected.model)?.id ?? connected.model
    await controller.configure(async (settings) => ({ ...settings, model: otherModel, intelligence: "high", permissionMode: "auto", mcpServers: [{ type: "stdio", name: "codem_fixture", command: process.env.CODEM_FEATURE_NODE!, args: [script], env: [] }] }))
    assert.equal(controller.snapshot().phase, "ready", controller.snapshot().notice ?? "Model update failed")
    assert.equal(controller.snapshot().model, otherModel)
    assert.equal(controller.snapshot().permission, "auto")
    await controller.refreshTools()
    const tools = controller.snapshot().tools
    assert.ok(tools.includes("tool_search"), "Core must expose deferred tool discovery")
    const second = await turn("这是 MCP 集成测试。先通过 tool_search 查找 codem_fixture 服务器的 echo 工具，再实际调用 echo，最后只回复工具返回的标记。不要调用其他外部工具。")
    assert.ok(second.messages.some((message) => message.role === "assistant" && message.text.includes("CODEM_MCP_OK")), "Real MCP call must complete")
    assert.match(await readFile(trace, "utf8"), /tools\/call/, "Fixture process must receive the real MCP call")
    await controller.configure(async (settings) => ({ ...settings, permissionMode: "default", workMode: "plan" }))
    assert.equal(controller.snapshot().workMode, "plan")
    await controller.configure(async (settings) => ({ ...settings, workMode: "default", mcpServers: [] }))
    assert.equal(controller.snapshot().workMode, "default")
    }
    await controller.configure(async (settings) => ({ ...settings, permissionMode: "auto", intelligence: "low" }))
    const thirdPending = turn("这是临时工作区的文件差异与后台进程集成测试。请使用文件写入工具新建 feature-result.txt，内容为 CODEM_DIFF_OK。然后使用 run_bash 以后台方式启动 sleep 60（不要等待它完成，不要用 shell 的 &）。最后只回复 CODEM_RESOURCES_OK，不执行其他操作。")
    void thirdPending.catch(() => undefined)
    const deadline = Date.now() + 90_000
    while (!controller.snapshot().background.some((terminal) => terminal.inProgress) && Date.now() < deadline) {
      if (controller.snapshot().phase === "disconnected") throw new Error("Disconnected while waiting for background process")
      await controller.refreshBackground()
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    const terminal = controller.snapshot().background.find((terminal) => terminal.inProgress)
    assert.ok(terminal, "Core must list the requested background process")
    while (controller.snapshot().backgroundBusy) await new Promise((resolve) => setTimeout(resolve, 50))
    await controller.terminateBackground(terminal.id)
    const stoppedDeadline = Date.now() + 5000
    while (controller.snapshot().background.some((item) => item.id === terminal.id && item.inProgress) && Date.now() < stoppedDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      await controller.refreshBackground()
    }
    assert.equal(controller.snapshot().background.some((item) => item.id === terminal.id && item.inProgress), false)
    const third = await thirdPending
    assert.match(await readFile(join(connected.cwd, "feature-result.txt"), "utf8"), /CODEM_DIFF_OK/)
    assert.ok(third.diffs.some((diff) => diff.label === "feature-result.txt"), "Real Core file diff must reach the UI")
    await controller.cleanBackground()
    assert.equal(controller.snapshot().backgroundBusy, false)
    console.log(process.env.CODEM_RESOURCES_ONLY === "1" ? "CODEM_LIVE_RESOURCES_OK: actual file diff, background process list/terminate/clean" : "CODEM_LIVE_FEATURES_OK: attachment, model/effort/modes, MCP discovery/call, actual file diff, background process list/terminate/clean")
  } finally { await controller.dispose() }
}
