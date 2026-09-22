import { readdir } from "node:fs/promises"
import { join } from "node:path"

/** Entry directories assemble features; adding a new feature requires a named home. */
export async function checkSourceLayout(root: string): Promise<void> {
  const boundaries = [
    { path: "src", files: ["extension.ts"], folders: ["chat", "connection", "sessionHistory", "resources", "integrations", "panels", "nativeChat", "plugins", "shared"] },
    { path: "webview", files: ["main.ts", "styles.css"], folders: ["account", "composer", "transcript", "sessionHistory", "panels", "resources", "status", "components", "styles", "host"] },
    { path: "webview/components", files: ["utils.ts", "componentStyles.ts"], folders: ["ui"] },
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
