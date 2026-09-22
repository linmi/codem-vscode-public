import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomBytes, randomInt, randomUUID } from "node:crypto"
import { deflateSync } from "node:zlib"
import { ChatController } from "../src/chat/chatController.ts"
import { liveRuntime } from "./liveRuntime.ts"
import { attachmentScope } from "../src/shared/pastedImages.ts"

/** Random order is never included in the prompt; low-amplitude noise also exercises large-image previews. */
function imageFixture(): { bytes: Buffer; colors: string[] } {
  const quadrants = [
    { name: "red", rgb: [224, 0, 0] }, { name: "green", rgb: [0, 224, 0] },
    { name: "blue", rgb: [0, 0, 224] }, { name: "yellow", rgb: [224, 224, 0] },
  ]
  for (let index = quadrants.length - 1; index > 0; index--) {
    const other = randomInt(index + 1)
    ;[quadrants[index], quadrants[other]] = [quadrants[other]!, quadrants[index]!]
  }
  const chunk = (name: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(name), data]); let crc = 0xffffffff
    for (const byte of body) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([size, body, checksum])
  }
  const size = 1024, stride = 1 + size * 3
  const rows = Buffer.alloc(size * stride), noise = randomBytes(size * size * 3)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const rgb = quadrants[(y >= size / 2 ? 2 : 0) + (x >= size / 2 ? 1 : 0)]!.rgb
    for (let channel = 0; channel < 3; channel++) rows[y * stride + 1 + x * 3 + channel] = rgb[channel]! + (noise[(y * size + x) * 3 + channel]! & 31)
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2
  return { colors: quadrants.map(item => item.name), bytes: Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]) }
}

export async function runLiveImages(extensionRoot: string, workspace: string, pasted = false): Promise<void> {
  const { bytes, colors } = imageFixture(); assert.ok(bytes.length > 512 * 1024)
  const path = join(workspace, `acceptanceImage-${randomUUID()}.png`)
  const sessionsRoot = await mkdtemp(join(tmpdir(), "codemImageHistory"))
  const previousRoot = process.env.LINCO_SESSIONS_ROOT
  process.env.LINCO_SESSIONS_ROOT = sessionsRoot
  const tools = new Set<string>()
  const createController = () => new ChatController({
    connect: async signal => {
      const session = await liveRuntime(extensionRoot, workspace, signal)
      console.log(`IMAGE_MODEL ${JSON.stringify(session.models.find(model => model.id === session.model))}`)
      session.host.onEvent(event => { if (event.type === "item-started" && event.item.toolName) tools.add(event.item.toolName) })
      return session
    },
    assertTrusted() {}, publish() {},
    interact: async request => {
      if (request.kind === "permission" && request.toolName === "describe_image" && request.options.some(option => option.id === "allow_once")) return { kind: "permission", optionId: "allow_once" }
      throw new Error("Image acceptance only approves image recognition")
    },
    report: (operation, error) => console.log(`IMAGE_FAILURE ${operation}: ${error instanceof Error ? error.message : "unknown"}`),
  })
  let controller = createController()
  try {
    await writeFile(path, bytes, { flag: "wx" })
    await controller.connect(); assert.equal(controller.snapshot().phase, "ready")
    // Use the actual selected model, including supportsVision=false. Core owns image processing.
    if (pasted) {
      assert.equal(await controller.pasteImages({ type: "pasteImages", requestId: "live-paste", scope: attachmentScope(controller.snapshot()), images: [{ mediaType: "image/png", data: bytes.toString("base64") }] }), null)
    } else {
      await controller.addAttachments(async () => [{ kind: "image", path }])
    }
    const attachment = controller.snapshot().attachments[0]!
    assert.equal((await controller.loadImage(attachment.id)).kind, "image")
    const started = performance.now()
    assert.equal(await controller.send("识别随附图片，按左上、右上、左下、右下顺序，只返回四个英文颜色名称，以逗号分隔。允许使用 describe_image 图片识别工具读取这张附件；不要执行命令、修改文件或读取无关文件。"), true)
    assert.equal(controller.snapshot().attachments.length, 0)
    const deadline = Date.now() + 120000
    while (controller.snapshot().phase !== "ready" && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(controller.snapshot().phase, "ready")
    assert.equal(controller.snapshot().notice, null)
    const answer = controller.snapshot().messages.filter(message => message.role === "assistant").at(-1)?.text ?? ""
    const colorNames: Record<string, string> = { red: "red", 红色: "red", green: "green", 绿色: "green", blue: "blue", 蓝色: "blue", yellow: "yellow", 黄色: "yellow" }
    const recognized = answer.toLowerCase().match(/\b(red|green|blue|yellow)\b|红色|绿色|蓝色|黄色/g)?.map(name => colorNames[name])
    assert.deepEqual(recognized, colors, `Image content must be recognized: ${answer}`)
    const threadId = controller.snapshot().threadId!
    assert.ok(threadId)
    console.log(`IMAGE_RECOGNIZED ${JSON.stringify({ colors, tools: [...tools], elapsedMs: Math.round(performance.now() - started) })}`)
    await controller.dispose()
    await rm(path) // History must restore Core's durable copy, not the original attachment file.
    controller = createController()
    await controller.connect(); assert.equal(controller.snapshot().phase, "ready")
    await controller.showHistory()
    assert.ok(controller.snapshot().history.entries.some(entry => entry.id === threadId), "Reconnected history list must contain the image conversation")
    await controller.resumeThread(threadId)
    assert.equal(controller.snapshot().threadId, threadId)
    assert.equal(controller.snapshot().notice, null)
    const images = controller.snapshot().messages.flatMap(message => "attachments" in message ? message.attachments ?? [] : []).filter(item => item.kind === "image")
    assert.equal(images.length, 1, "Real JSONL must restore the image after reconnect")
    const preview = await controller.loadImage(images[0]!.id)
    assert.equal(preview.kind, "image")
    if (preview.kind === "image") assert.deepEqual(Buffer.from(preview.dataUrl.split(",")[1]!, "base64"), bytes)
    assert.equal((await controller.loadImage(attachment.id)).kind, "unavailable", "Old connection handles must expire")
    console.log(`CODEM_LIVE_IMAGES_OK source=${pasted ? "paste" : "file"} bytes=${bytes.length} actual-recognition, reconnect, JSONL-restore, history-bytes-match`)
  } finally {
    try { await controller.dispose() }
    finally {
      if (previousRoot === undefined) delete process.env.LINCO_SESSIONS_ROOT
      else process.env.LINCO_SESSIONS_ROOT = previousRoot
      await Promise.all([rm(path, { force: true }), rm(sessionsRoot, { recursive: true, force: true })])
    }
  }
}
