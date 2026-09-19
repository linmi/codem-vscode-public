import type { ActivityMessage } from "../src/messages.ts"
import { uiIcon } from "../src/uiIcons.ts"

export function toolPresentation(name: string): { title: string; icon: string; kind: string } {
  const known: Record<string, { title: string; icon: Parameters<typeof uiIcon>[0]; kind: string }> = {
    grep: { title: "搜索内容", icon: "search", kind: "search" },
    list_dir: { title: "查看目录", icon: "folder", kind: "read" },
    run_bash: { title: "执行命令", icon: "terminal", kind: "command" },
    read_files: { title: "读取文件", icon: "file", kind: "read" },
    write_file: { title: "写入文件", icon: "file", kind: "write" },
    edit_file: { title: "编辑文件", icon: "file", kind: "write" },
    web_search: { title: "搜索网页", icon: "search", kind: "search" },
    web_fetch: { title: "读取网页", icon: "globe", kind: "web" },
    tool_search: { title: "查找工具", icon: "search", kind: "search" },
  }
  const entry = known[name]
  if (entry) return { ...entry, icon: uiIcon(entry.icon) }
  if (name.startsWith("MCP · ") || name.startsWith("mcp__")) return { title: name.replace(/^MCP · /, ""), icon: uiIcon("plug"), kind: "mcp" }
  return { title: name, icon: uiIcon("tool"), kind: "tool" }
}


// Only use the Host's whitelisted projection, never raw tool arguments or output.
export function activityTitle(message: ActivityMessage): string {
  if (message.role === "reasoning") return message.summary.trim() || (message.status === "running" ? "正在思考" : "思考过程")
  const title = toolPresentation(message.label).title
  const verbs: Record<string, [string, string]> = {
    run_bash: ["正在运行", "已运行"],
    read_files: ["正在读取", "已读取"],
    write_file: ["正在写入", "已写入"],
    edit_file: ["正在编辑", "已编辑"],
    grep: ["正在搜索内容", "已搜索内容"],
    list_dir: ["正在查看目录", "已查看目录"],
    web_search: ["正在搜索网页", "已搜索网页"],
    web_fetch: ["正在读取网页", "已读取网页"],
    tool_search: ["正在查找工具", "已查找工具"],
  }
  const verb = verbs[message.label]
  const action = verb && (message.status === "running" || message.status === "completed")
    ? verb[message.status === "running" ? 0 : 1] : title
  const context = message.details?.code || message.details?.fields.map(field => field.value).filter(Boolean).join("、") || ""
  return [action, context.replace(/\s+/g, " ").trim()].filter(Boolean).join(" ")
}
