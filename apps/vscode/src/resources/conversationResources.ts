import { mkdtempSync, realpathSync } from "node:fs"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { MAX_ATTACHMENTS, parsePastedImages, type PastedImage } from "../shared/pastedImages.ts"
import { basename, join } from "node:path"
import { randomUUID } from "node:crypto"
import type { AppServerPromptAttachment } from "@codem/app-server"
import { readSessionImage, resolveSessionsRoot, type ConversationAttachment, type SessionHistoryPage } from "@codem/history"
import type { AttachmentView, ChatMessage, DiffView } from "../shared/messages.ts"
import { UserVisibleError } from "../shared/userVisibleError.ts"
import { historyMessages } from "../sessionHistory/historyMessages.ts"
import { Artifacts, type ArtifactInput } from "./artifacts.ts"
import { FileReferences } from "./fileReferences.ts"
import { changedFilePath, displayPath, validateAttachment, type FileDiffContent } from "./filePresentation.ts"
import { attachmentPreview, rasterPreview, rasterMediaType } from "./attachmentPreview.ts"

/** Owns opaque resource handles for one conversation; never owns connection or UI state. */
export class ConversationResources {
  private readonly artifacts = new Artifacts()
  private readonly references = new FileReferences()
  private readonly images = new Map<string, () => Promise<AttachmentView["preview"]>>()
  private readonly attachments = new Map<string, AppServerPromptAttachment>()
  private readonly diffs = new Map<string, FileDiffContent>()
  private readonly diffIds = new Map<string, string>()
  private revision = 0
  private imageRoot: string | null = null

  /** Stable private root: authorize before the first turn, including text-only threads. */
  rootForCore(): string {
    return this.imageRoot ??= realpathSync(mkdtempSync(join(tmpdir(), "codem-images-")))
  }

  /** Call only after every Core using this owner has closed. */
  async disposeImages(): Promise<void> {
    await this.finishImageCleanup()
    if (this.imageRoot) await rm(this.imageRoot, { recursive: true, force: true })
    this.imageRoot = null
  }
  private readonly pastedDirectories = new Map<string, string>()
  private readonly imageImports = new Set<Promise<AttachmentView[]>>()
  private readonly imageCleanup = new Set<Promise<void>>()
  private readonly cleanupErrors: unknown[] = []

  clear(preserveAttachments = false, releaseAfter: Promise<unknown> = Promise.resolve()): void {
    this.revision++
    this.artifacts.clear()
    this.references.clear()
    this.images.clear()
    if (!preserveAttachments) this.attachments.clear()
    for (const [id, item] of this.attachments) {
      if (item.kind === "image") this.images.set(id, () => attachmentPreview(item))
    }
    for (const id of this.pastedDirectories.keys()) if (!this.attachments.has(id)) this.releasePastedImage(id, releaseAfter)
    this.diffs.clear()
    this.diffIds.clear()
  }

  attachmentViews(cwd: string | null): AttachmentView[] {
    return [...this.attachments].map(([id, item]) => ({ id, label: cwd === null ? basename(item.path) : displayPath(cwd, item.path), kind: item.kind, preview: item.kind === "image" ? { kind: "deferred" } : { kind: "none" } }))
  }

  selected(): AppServerPromptAttachment[] { return [...this.attachments.values()].map(item => ({ ...item })) }
  selectedIds(): string[] { return [...this.attachments.keys()] }
  contains(path: string): boolean { return this.selected().some(item => item.path === path) }
  remove(id: string): void { this.attachments.delete(id) }

  async validateSelection(): Promise<void> {
    for (const item of this.attachments.values()) await validateAttachment(item)
  }

  async add(cwd: string | null, chosen: readonly AppServerPromptAttachment[], assertCurrent: () => void): Promise<AttachmentView[]> {
    const revision = this.revision
    const unique = chosen.filter((item, index) => !this.contains(item.path) && chosen.findIndex(other => other.path === item.path) === index)
    if (this.attachments.size + unique.length > MAX_ATTACHMENTS) throw new UserVisibleError("每条消息最多添加 20 个附件。")
    for (const item of unique) await validateAttachment(item)
    if (revision !== this.revision) throw new Error("Attachment selection expired")
    assertCurrent()
    return unique.map(item => {
      const id = randomUUID()
      this.attachments.set(id, { ...item })
      if (item.kind === "image") this.images.set(id, () => attachmentPreview(item))
      return { id, label: cwd === null ? basename(item.path) : displayPath(cwd, item.path), kind: item.kind, preview: item.kind === "image" ? { kind: "deferred" } : { kind: "none" } }
    })
  }

  addPastedImages(images: readonly PastedImage[], assertCurrent: () => void): Promise<AttachmentView[]> {
    const task = this.importImages(images, assertCurrent)
    this.imageImports.add(task)
    const settled = () => { this.imageImports.delete(task) }
    void task.then(settled, settled)
    return task
  }

  private async importImages(images: readonly PastedImage[], assertCurrent: () => void): Promise<AttachmentView[]> {
    const revision = this.revision
    const checked = parsePastedImages(images)
    if (this.attachments.size + checked.length > MAX_ATTACHMENTS) throw new UserVisibleError("每条消息最多添加 20 个附件。")
    const created: { directory: string; path: string }[] = []
    try {
      for (const image of checked) {
        assertCurrent()
        if (revision !== this.revision) throw new Error("Image paste expired")
        const bytes = Buffer.from(image.data, "base64")
        if (bytes.toString("base64") !== image.data || rasterMediaType(bytes) !== image.mediaType) throw new UserVisibleError("剪贴板图片格式无效，请重新复制 PNG、JPEG、GIF 或 WebP 图片。")
        const directory = await mkdtemp(join(this.rootForCore(), "paste-"))
        const path = join(directory, `粘贴图片.${image.mediaType === "image/jpeg" ? "jpg" : image.mediaType.slice(6)}`)
        created.push({ directory, path })
        await writeFile(path, bytes, { flag: "wx", mode: 0o600 })
      }
      if (revision !== this.revision) throw new Error("Image paste expired")
      assertCurrent()
      if (this.attachments.size + created.length > MAX_ATTACHMENTS) throw new UserVisibleError("每条消息最多添加 20 个附件。")
      return created.map(({ directory, path }): AttachmentView => {
        const id = randomUUID()
        const item = { kind: "image" as const, path }
        this.attachments.set(id, item)
        this.images.set(id, () => attachmentPreview(item))
        this.pastedDirectories.set(id, directory)
        return { id, label: basename(path), kind: "image", preview: { kind: "deferred" } }
      })
    } catch (error) {
      await Promise.all(created.map(item => rm(item.directory, { recursive: true, force: true })))
      throw error
    }
  }

  private releasePastedImage(id: string, after: Promise<unknown> = Promise.resolve()): void {
    const directory = this.pastedDirectories.get(id)
    if (!directory) return
    this.pastedDirectories.delete(id)
    // Retiring Core may still be reading a submitted localImage. Wait for its close.
    const task = after.then(() => rm(directory, { recursive: true, force: true }))
      .catch(error => { this.cleanupErrors.push(error) })
    this.imageCleanup.add(task)
    void task.then(() => { this.imageCleanup.delete(task) })
  }

  async finishImageCleanup(): Promise<void> {
    await Promise.allSettled(this.imageImports)
    await Promise.all(this.imageCleanup)
    if (this.cleanupErrors.length) throw new AggregateError(this.cleanupErrors.splice(0), "Pasted image cleanup failed")
  }

  search(cwd: string, query: string, find: (cwd: string, query: string) => Promise<readonly string[]>) { return this.references.search(cwd, query, find) }
  resolveFile(cwd: string, id: string) { return this.references.resolve(cwd, id) }
  projectArtifacts(items: readonly ArtifactInput[], cwd: string) { return this.artifacts.project(items, cwd) }
  resolveArtifact(cwd: string, id: string) { return this.artifacts.resolve(cwd, id) }
  diff(id: string): FileDiffContent | undefined { return this.diffs.get(id) }

  async loadImage(id: string): Promise<AttachmentView["preview"]> {
    const load = this.images.get(id)
    if (!load) throw new Error("Unknown image")
    const preview = await load()
    if (this.images.get(id) !== load) throw new Error("Image reference expired")
    return preview
  }

  retainImages(attachments: readonly AttachmentView[], messages: readonly ChatMessage[]): void {
    const ids = new Set([...this.attachments.keys(), ...[...attachments, ...messages.flatMap(message => "attachments" in message ? message.attachments ?? [] : [])].map(item => item.id)])
    for (const id of this.images.keys()) if (!ids.has(id)) { this.images.delete(id); this.releasePastedImage(id) }
  }

  recordDiff(cwd: string, turnId: string, itemId: string, diff: FileDiffContent): DiffView {
    const key = JSON.stringify([turnId, itemId])
    const id = this.diffIds.get(key) ?? randomUUID()
    this.diffIds.set(key, id)
    this.diffs.set(id, diff)
    return { id, turnId, label: displayPath(cwd, diff.path), added: diff.stats.linesAdded, removed: diff.stats.linesRemoved, preview: diff.preview.kind, available: true }
  }

  restoreDiffs(cwd: string, page: SessionHistoryPage, replace: boolean, previous: readonly DiffView[]): DiffView[] {
    if (replace) { this.diffs.clear(); this.diffIds.clear() }
    const restored = page.turns.flatMap(({ turn }) => turn.items.flatMap(item => item.kind === "file-diff" ? [this.recordDiff(cwd, turn.id, item.id, item.diff)] : []))
    return replace ? restored : [...restored, ...previous.filter(diff => !restored.some(row => row.id === diff.id))]
  }

  projectHistory(threadId: string, page: SessionHistoryPage, cwd: string) {
    return historyMessages(threadId, page, (item: ConversationAttachment): AttachmentView => {
      const id = randomUUID()
      const kind = item.kind === "session-image" ? "image" : item.kind
      if (kind === "image") this.images.set(id, async () => {
        if (item.kind === "session-image") {
          const bytes = await readSessionImage({ sessionsRoot: resolveSessionsRoot(process.env), cwd: cwd, threadId, attachment: item })
          const preview = rasterPreview(bytes)
          if (preview.kind !== "image" || !preview.dataUrl.startsWith(`data:${item.mediaType};`)) throw new Error("Image media type mismatch")
          return preview
        }
        return attachmentPreview({ kind: "image", path: await changedFilePath(cwd, item.path) })
      })
      return { id, label: item.kind === "session-image" ? item.displayName : displayPath(cwd, item.path), kind, preview: kind === "image" ? { kind: "deferred" } : { kind: "none" } }
    }, items => this.artifacts.project(items, cwd), cwd)
  }

}
