import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { ChatController, type ChatSession } from "../src/chat/chatController.ts"
import { PanelBroker } from "../src/panels/panelBroker.ts"
import { showInteraction } from "../src/panels/interactions.ts"
import type { AppServerInteraction } from "@codem/app-server"
import type { PanelView } from "../src/shared/panelTypes.ts"

/** Opt-in real Core test, confined to the smoke runner's disposable workspace and its parent. */
export async function runLiveInteractions(adapter: { connect: (signal: AbortSignal) => Promise<ChatSession>; assertTrusted: () => void }): Promise<void> {
  let session: ChatSession | null = null
  let pending: PanelView | null = null
  let request: AppServerInteraction | null = null
  let mode: "allow" | "deny" | "question" | "cancel" | "plan" = "allow"
  let questionStep = 0
  let planRejected = false
  let stoppedPlan = false
  const observed: string[] = []
  let command = ""
  const panels = new PanelBroker(), owner = {}
  panels.bind(owner, message => { pending = message.panel })
  const answer = (ids: string[], text = "", cancelled = false) => {
    assert.ok(pending)
    panels.answer(owner, { type: "panelReply", id: pending.id, choiceIds: ids, text, cancelled })
  }
  const controller = new ChatController({
    connect: async (signal) => { session = await adapter.connect(signal); return session },
    assertTrusted: adapter.assertTrusted, publish() {}, report: operation => console.log(`INTERACTION_FAILURE ${operation}`),
    interact: async (incoming, signal, cwd) => {
      request = incoming
      observed.push(`${mode}:${incoming.kind}`)
      console.log(`REAL_INTERACTION ${mode} ${incoming.kind}`)
      const result = showInteraction(incoming, signal, panels, cwd)
      void result.finally(() => { request = null }).catch(() => undefined)
      return result
    },
  })
  async function turn(text: string): Promise<void> {
    const accepted = await controller.send(text)
    assert.equal(accepted, true)
    const deadline = Date.now() + 120000
    while (controller.snapshot().phase !== "ready" && Date.now() < deadline) {
      assert.notEqual(controller.snapshot().phase, "disconnected")
      const panel: PanelView | null = pending
      const interaction: AppServerInteraction | null = request
      if (panel && interaction) {
        if (mode === "plan" && planRejected) {
          stoppedPlan = true
          await controller.stop()
          await new Promise(resolve => setTimeout(resolve, 50))
          continue
        }
        if (interaction.kind === "permission") {
          assert.ok(mode === "allow" || mode === "deny", "Unexpected permission during another scenario")
          assert.equal(interaction.preview.kind, "bash_command")
          if (interaction.preview.kind !== "bash_command") throw new Error("Only fixture commands are allowed")
          assert.equal(interaction.preview.command.trim(), command)
          const choice = interaction.options.find(option => option.id === (mode === "allow" ? "allow_once" : "reject_once"))
          assert.ok(choice, `Missing permission option: ${interaction.options.map(option => option.id).join(",")}`)
          const index = interaction.options.indexOf(choice)
          answer([panel.choices[index]!.id])
        } else if (interaction.kind === "question") {
          if (mode === "cancel") answer([], "", true)
          else {
            assert.equal(mode, "question"); assert.equal(interaction.questions.length, 2)
            if (questionStep === 1) { assert.ok(panel.backChoiceId); answer([panel.backChoiceId]) }
            else if (questionStep === 2) { assert.equal(panel.initialText, "first note"); assert.equal(panel.choices[0]!.selected, true); answer([panel.choices[1]!.id], "revised note") }
            else answer([panel.choices[0]!.id], questionStep === 0 ? "first note" : "second note")
            questionStep++
          }
        } else if (interaction.kind === "plan" || interaction.kind === "plan-mode") {
          assert.equal(mode, "plan")
          if (interaction.kind === "plan") planRejected = true
          answer([panel.choices[interaction.kind === "plan" ? 1 : 0]!.id], interaction.kind === "plan" ? "请补充验收测试。" : "")
        } else throw new Error("Unexpected interaction")
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(controller.snapshot().phase, "ready", "Interaction turn timed out")
    assert.equal(pending, null)
    assert.equal(controller.snapshot().notice, null, "Core must complete or honor the explicit stop after rejected-plan follow-up")
    assert.equal(controller.snapshot().messages.at(-1)?.role === "turnStatus", stoppedPlan)
  }
  try {
    await controller.connect(); assert.equal(controller.snapshot().phase, "ready"); assert.ok(session)
    const connected: ChatSession = session
    await controller.configure(async settings => ({ ...settings, permissionMode: "default", intelligence: "low" }))
    for (const decision of ["allow", "deny"] as const) {
      mode = decision
      const path = join(dirname(connected.cwd), `${decision}Approval.txt`)
      command = `printf CODEM_${decision.toUpperCase()} > '${path}'`
      await turn(`这是临时目录内的客户端审批验收。请仅使用 run_bash 执行一次下面的原样命令，工作区外的这个文件也是专用测试文件：\n${command}\n遇到拒绝就停止，不要重试、改用其他工具或读取文件。最后简短回复并结束。`)
      assert.ok(observed.includes(`${decision}:permission`), `Core did not issue a real ${decision} approval`)
      if (decision === "allow") assert.equal(await readFile(path, "utf8"), "CODEM_ALLOW")
      else await assert.rejects(stat(path), { code: "ENOENT" })
      await controller.newChat()
    }
    mode = "question"
    await turn("客户端多题回退验收：请实际调用 ask_user，一次包含两个问题。问题一标题第一题，问题二标题第二题，各有 A 和 B 两个选项。拿到答复后简短复述最终选择和补充文字并结束，不要再提问或执行任何操作。")
    assert.equal(questionStep, 4)
    await controller.newChat(); mode = "cancel"
    await turn("客户端取消验收：请实际调用 ask_user 提一个问题，选项 A 和 B。用户取消后简短回复并结束，不再提问、不执行其他操作。")
    assert.ok(observed.includes("cancel:question"))
    await controller.newChat(); mode = "plan"
    await controller.configure(async settings => ({ ...settings, workMode: "plan" }))
    await turn("客户端计划审批验收：不要读取或修改文件。请制定只包含新增一份临时说明文档的简短计划，并实际调用 exit_plan_mode 请求用户审批。如果被拒绝，简短说明收到反馈并结束，不要重复请求或执行计划。")
    assert.ok(observed.includes("plan:plan"))
    console.log(`CODEM_LIVE_INTERACTIONS_OK ${JSON.stringify(observed)}`)
  } finally { panels.cancel(); await controller.dispose() }
}
