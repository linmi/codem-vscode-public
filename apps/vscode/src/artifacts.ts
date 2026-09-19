import { randomUUID } from "node:crypto"
import type { AppServerFinalAnswerArtifact } from "@codem/app-server"
import type { ArtifactView } from "./messages.ts"
import { changedFilePath, displayPath } from "./filePresentation.ts"

export type ArtifactSource = { kind: "file"; path: string } | { kind: "url"; url: string } | { kind: "chart"; text: string }
export type ArtifactInput = Pick<AppServerFinalAnswerArtifact, "kind" | "title"> & Partial<AppServerFinalAnswerArtifact>
export class Artifacts {
  private handles = new Map<string, { cwd: string; source: ArtifactSource }>()
  clear(): void { this.handles.clear() }
  project(items: readonly ArtifactInput[], cwd: string): ArtifactView[] {
    return items.slice(0, 50).map(item => {
      const id = randomUUID()
      let source: ArtifactSource | null = null
      let detail = "未提供可打开的产物"
      if (item.path) { source = { kind: "file", path: item.path }; detail = displayPath(cwd, item.path) }
      else if (item.uri) {
        try { const url = new URL(item.uri); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) { source = { kind: "url", url: url.href }; detail = url.hostname } } catch { /* rejected schemes stay unavailable */ }
      } else if (item.kind === "chart" && item.spec !== null && item.spec !== undefined) {
        const text = JSON.stringify(item.spec, null, 2)
        if (text.length <= 256 * 1024) { source = { kind: "chart", text }; detail = "图表定义 · 只读预览" }
      }
      if (source) this.handles.set(id, { cwd, source })
      return { id, kind: item.kind, title: item.title || item.filename || "未命名产物", detail, available: source !== null }
    })
  }
  async resolve(cwd: string, id: string): Promise<ArtifactSource> {
    const entry = this.handles.get(id)
    if (!entry || entry.cwd !== cwd) throw new Error("Artifact has expired")
    const source = entry.source.kind === "file" ? { kind: "file" as const, path: await changedFilePath(cwd, entry.source.path) } : entry.source
    if (this.handles.get(id) !== entry) throw new Error("Artifact has expired")
    return source
  }
}
