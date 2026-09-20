import { randomUUID } from "node:crypto"
import { extname } from "node:path"
import { changedFilePath, displayPath } from "./filePresentation.ts"
import type { AppServerPromptAttachment } from "@codem/app-server"

export interface FileReference { id: string; label: string }
/** Search handles are short lived and never authorize a path supplied by Webview. */
export class FileReferences {
  private revision = 0
  private handles = new Map<string, { cwd: string; path: string }>()
  clear(): void { this.revision++; this.handles.clear() }
  async search(cwd: string, query: string, find: (cwd: string, query: string) => Promise<readonly string[]>): Promise<FileReference[]> {
    this.clear()
    const revision = this.revision
    const paths = await find(cwd, query)
    const entries: FileReference[] = []
    for (const path of paths.slice(0, 50)) {
      let checked: string
      try { checked = await changedFilePath(cwd, path) } catch { continue }
      if (revision !== this.revision) return []
      const id = randomUUID()
      this.handles.set(id, { cwd, path: checked })
      entries.push({ id, label: displayPath(cwd, path) })
    }
    return entries
  }
  async resolve(cwd: string, id: string): Promise<AppServerPromptAttachment> {
    const handle = this.handles.get(id)
    if (!handle || handle.cwd !== cwd) throw new Error("File search result expired")
    const path = await changedFilePath(cwd, handle.path)
    if (this.handles.get(id) !== handle) throw new Error("File search result expired")
    return { kind: [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extname(path).toLowerCase()) ? "image" : "file", path }
  }
}
