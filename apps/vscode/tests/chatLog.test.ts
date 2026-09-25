import assert from "node:assert/strict"
import { it } from "node:test"
import { ChatLog } from "../src/chat/chatLog.ts"
import { UserVisibleError } from "../src/shared/userVisibleError.ts"

it("logs each phase change once and times a connection attempt until it settles", () => {
  const lines: string[] = []
  const log = new ChatLog(line => lines.push(line))
  log.phase("disconnected"); log.phase("disconnected")
  assert.deepEqual(lines, ["UI phase: disconnected"], "A repeated phase is not logged again")
  log.phase("connecting"); log.phase("ready")
  assert.equal(lines[1], "UI phase: connecting")
  assert.match(lines[2]!, /^Connection ready: \d+ms$/)
  assert.equal(lines[3], "UI phase: ready")
  log.phase("running"); log.phase("ready")
  assert.deepEqual(lines.slice(4), ["UI phase: running", "UI phase: ready"], "Only the phase after connecting carries a connection timing")
  log.phase("connecting"); log.phase("disconnected")
  assert.match(lines.at(-2)!, /^Connection disconnected: \d+ms$/, "A failed attempt is timed too")
})

it("reports only user-visible messages, never raw error payloads", () => {
  const lines: string[] = []
  const log = new ChatLog(line => lines.push(line))
  log.report("connect", new UserVisibleError("请先打开一个项目文件夹。"))
  log.report("send", new Error("secret token in Core frame"))
  assert.match(lines[0]!, /^\d{4}-\d{2}-\d{2}T\S+ connect: 请先打开一个项目文件夹。$/)
  assert.match(lines[1]!, /^\S+ send: 操作失败；请检查运行时文件、CodeM 登录和网络连接。$/)
  assert.ok(!lines.join("\n").includes("secret"))
})
