import { readdir } from "node:fs/promises"
import { join } from "node:path"

/** Entry directories assemble features; adding a new feature requires a named home. */
export async function checkSourceLayout(root: string): Promise<void> {
  const boundaries = [
    { path: "src", files: ["extension.ts"], folders: ["chat", "connection", "sessionHistory", "resources", "integrations", "panels", "nativeChat", "plugins", "shared"] },
    // The chat view, its shadcn components and styles live in @codem/ui; the Webview only mounts it through the Host bridge.
    { path: "webview", files: ["main.ts", "styles.css"], folders: ["host"] },
  ]
  for (const boundary of boundaries) {
    for (const entry of await readdir(join(root, "apps/vscode", boundary.path), { withFileTypes: true })) {
      const path = `${boundary.path}/${entry.name}`
      if (entry.isDirectory() && !boundary.folders.includes(entry.name)) throw new Error(`${path}: undocumented feature directory`)
      if (!entry.isDirectory() && /\.(?:[cm]?[jt]sx?|css)$/.test(entry.name) && !boundary.files.includes(entry.name)) {
        throw new Error(`${path}: implementation must live in its feature directory`)
      }
    }
  }
}
