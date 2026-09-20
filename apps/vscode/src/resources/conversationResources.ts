import { basename } from "node:path"
import { randomUUID } from "node:crypto"
import type { AppServerPromptAttachment } from "@codem/app-server"
import { readSessionImage, resolveSessionsRoot, type ConversationAttachment, type SessionHistoryPage } from "@codem/session-history"
import type { AttachmentView, ChatMessage, DiffView } from "../shared/messages.ts"
import { UserVisibleError } from "../shared/userVisibleError.ts"
import { historyMessages } from "../sessionHistory/historyMessages.ts"
import { Artifacts, type ArtifactInput } from "./artifacts.ts"
import { FileReferences } from "./fileReferences.ts"
import { changedFilePath, displayPath, validateAttachment, type FileDiffContent } from "./filePresentation.ts"
import { attachmentPreview, rasterPreview } from "./attachmentPreview.ts"

/** Owns opaque resource handles for one conversation; never owns connection or UI state. */
export class ConversationResources {
  private readonly artifacts = new Artifacts()
  private readonly references = new FileReferences()
  private readonly images = new Map<string, () => Promise<AttachmentView["preview"]>>()
  private readonly attachments = new Map<string, AppServerPromptAttachment>()
  private readonly diffs = new Map<string, FileDiffContent>()
  private readonly diffIds = new Map<string, string>()
  private revision = 0

  clear(preserveAttachments = false): void {
    this.revision++
    this.artifacts.clear()
    this.references.clear()
    this.images.clear()
    if (!preserveAttachments) this.attachments.clear()
    for (const [id, item] of this.attachments) {
      if (item.kind === "image") this.images.set(id, () => attachmentPreview(item))
    }
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

  async validateSelection(supportsVision: boolean): Promise<void> {
    for (const item of this.attachments.values()) await validateAttachment(item)
    if (this.selected().some(item => item.kind === "image") && !supportsVision) throw new UserVisibleError("当前模型不支持图片，请切换模型或移除图片。")
  }

  async add(cwd: string | null, chosen: readonly AppServerPromptAttachment[], assertCurrent: () => void): Promise<AttachmentView[]> {
    const revision = this.revision
    const unique = chosen.filter((item, index) => !this.contains(item.path) && chosen.findIndex(other => other.path === item.path) === index)
    if (this.attachments.size + unique.length > 20) throw new UserVisibleError("每条消息最多添加 20 个附件。")
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
    const ids = new Set([...attachments, ...messages.flatMap(message => "attachments" in message ? message.attachments ?? [] : [])].map(item => item.id))
    for (const id of this.images.keys()) if (!ids.has(id)) this.images.delete(id)
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
