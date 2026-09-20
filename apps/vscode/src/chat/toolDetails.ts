import { displayPath } from "../resources/filePresentation.ts"
import type { ToolDetails } from "../shared/messages.ts"

/** Project known display fields only; never serialize arbitrary tool arguments or environment. */
export function projectToolDetails(name: string, input: unknown, cwd: string): ToolDetails | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const value = input as Record<string, unknown>
  const text = (key: string) => typeof value[key] === "string" ? (value[key] as string).slice(0, 8000) : ""
  if (name === "run_bash") return { kind: "command", fields: [], code: text("command").replace(/((?:token|password|api_key|authorization)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s;]+)/gi, "$1[已隐藏]") }
  if (["read_files", "write_file", "edit_file"].includes(name)) {
    // Core 0.8.44: read_files accepts files:[{path,...}] or one flat path, never paths:[].
    if (name === "read_files" && value.files !== undefined && value.path !== undefined) return null
    const paths = name === "read_files" && Array.isArray(value.files)
      ? value.files.flatMap(file => file && typeof file === "object" && typeof file.path === "string" ? [file.path] : [])
      : [text("path")].filter(Boolean)
    if (!paths.length) return null
    return { kind: "file", fields: paths.slice(0, 50).map(path => ({ label: "文件", value: displayPath(cwd, path) })), code: null }
  }
  if (name === "grep") return { kind: "search", fields: [{ label: "查询", value: text("pattern") }, { label: "范围", value: text("path") ? displayPath(cwd, text("path")) : "" }, { label: "匹配文件", value: text("glob") }].filter(field => field.value), code: null }
  if (name === "list_dir") return { kind: "file", fields: text("path") ? [{ label: "目录", value: displayPath(cwd, text("path")) }] : [], code: null }
  if (["web_search", "tool_search"].includes(name)) return { kind: "search", fields: [{ label: "查询", value: text("query") }], code: null }
  if (name === "web_fetch") {
    let url = ""
    try { const parsed = new URL(text("url")); if (["http:", "https:"].includes(parsed.protocol)) { parsed.username = ""; parsed.password = ""; url = parsed.toString() } } catch { /* malformed URLs have no display authority */ }
    return { kind: "web", fields: [{ label: "地址", value: url }], code: null }
  }
  if (name === "dispatch") return { kind: "subagent", fields: [{ label: "任务", value: text("label") }, { label: "类型", value: text("kind") }], code: null }
  if (name.startsWith("mcp__") || name.startsWith("MCP · ")) return { kind: "mcp", fields: [{ label: "工具", value: name.replace(/^MCP · /, "") }], code: null }
  return null
}
