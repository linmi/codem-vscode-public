import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { deflateSync } from "node:zlib"
import { ChatController } from "../src/chatController.ts"
import { liveRuntime } from "./liveRuntime.ts"

function png(): Buffer {
  const chunk = (name: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(name), data]); let crc = 0xffffffff
    for (const byte of body) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([size, body, checksum])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1024, 0); header.writeUInt32BE(1024, 4); header[8] = 8; header[9] = 2
  const rows = Array.from({ length: 1024 }, () => Buffer.concat([Buffer.from([0]), randomBytes(1024 * 3)]))
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))])
}

export async function runLiveImages(extensionRoot: string, workspace: string): Promise<void> {
  const bytes = png(); assert.ok(bytes.length > 512 * 1024)
  const path = join(workspace, "acceptanceImage.png"); await writeFile(path, bytes)
  const controller = new ChatController({ connect: (_signIn, signal) => liveRuntime(extensionRoot, workspace, signal), assertTrusted() {}, publish() {}, interact: async () => { throw new Error("Image test must not execute tools") }, report: (operation, error) => console.log(`IMAGE_FAILURE ${operation}: ${error instanceof Error ? error.message : "unknown"}`) })
  try {
    await controller.connect(); assert.equal(controller.snapshot().phase, "ready")
    let imageModelAvailable = false
    await controller.configure(async (settings, session) => {
      const model = session.models.find(model => model.id === settings.model && model.supportsVision) ?? session.models.find(model => model.supportsVision)
      assert.ok(model, "No image-capable model in the real Core catalog")
      imageModelAvailable = true
      return { ...settings, model: model.id }
    })
    assert.ok(imageModelAvailable, "Current real Core catalog has no image-capable model; cannot validate real image submission")
    await controller.addAttachments(async () => [{ kind: "image", path }])
    const attachment = controller.snapshot().attachments[0]!
    assert.equal((await controller.loadImage(attachment.id)).kind, "image")
    assert.equal(await controller.send("这是生成的随机像素测试图片。只回复 IMAGE_ACCEPTED，不调用任何工具，不读取或修改文件。"), true)
    const deadline = Date.now() + 120000
    while (controller.snapshot().phase !== "ready" && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(controller.snapshot().phase, "ready")
    assert.equal(controller.snapshot().notice, null)
    // Core's durable projection can settle after turn/completed.
    let restored = false
    for (let attempt = 0; attempt < 20; attempt++) {
      await controller.reloadHistory()
      const images = controller.snapshot().messages.flatMap(message => "attachments" in message ? message.attachments ?? [] : []).filter(item => item.kind === "image" && item.id !== attachment.id)
      if (images.length) { const preview = await controller.loadImage(images[0]!.id); assert.equal(preview.kind, "image"); restored = true; break }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    assert.ok(restored, "Real JSONL image attachment must restore and preview")
    console.log(`CODEM_LIVE_IMAGES_OK bytes=${bytes.length} live-preview, actual-send, JSONL-restore, history-preview`)
  } finally { await controller.dispose() }
}
