import { uiIcon } from "../src/uiIcons.ts"

export function toolPresentation(name: string): { title: string; icon: string; kind: string } {
  const known: Record<string, { title: string; icon: Parameters<typeof uiIcon>[0]; kind: string }> = {
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
