import type { ActivityMessage, ActivityStatus } from "../../src/shared/messages.ts"
import { uiIcon } from "../../src/shared/uiIcons.ts"

type Icon = Parameters<typeof uiIcon>[0]
interface ToolPresentation { title: string; icon: Icon; kind: string; verb?: string; subject: readonly string[] }
// Subjects keep the collapsed row short; all other whitelisted fields remain in the disclosure.
const known: Record<string, ToolPresentation> = {
  skill: { title: "加载技能", icon: "tool", kind: "skill", subject: ["技能"] },
  grep: { title: "搜索内容", icon: "search", kind: "search", subject: ["查询", "范围", "匹配文件"] },
  glob: { title: "查找文件", icon: "search", kind: "search", subject: ["查询", "范围"] },
  search_and_read: { title: "搜索并读取", icon: "search", kind: "search", subject: ["查询", "范围"] },
  list_dir: { title: "查看目录", icon: "folder", kind: "read", subject: ["目录"] },
  run_bash: { title: "执行命令", verb: "运行", icon: "terminal", kind: "command", subject: [] },
  verify: { title: "运行验证", icon: "check", kind: "command", subject: [] },
  read_files: { title: "读取文件", verb: "读取", icon: "file", kind: "read", subject: ["文件"] },
  write_file: { title: "写入文件", verb: "写入", icon: "file", kind: "write", subject: ["文件"] },
  edit_file: { title: "编辑文件", verb: "编辑", icon: "file", kind: "write", subject: ["文件"] },
  multi_edit: { title: "批量编辑文件", icon: "file", kind: "write", subject: ["文件", "修改数量"] },
  patch_file: { title: "修改文件行段", icon: "file", kind: "write", subject: ["文件", "目标范围"] },
  web_search: { title: "搜索网页", icon: "search", kind: "search", subject: ["查询"] },
  web_fetch: { title: "读取网页", icon: "globe", kind: "web", subject: ["地址"] },
  tool_search: { title: "查找工具", icon: "search", kind: "search", subject: ["查询"] },
  shell_bg_list: { title: "查看后台进程", icon: "terminal", kind: "process", subject: [] },
  shell_bg_read: { title: "读取后台日志", icon: "terminal", kind: "process", subject: ["进程 PID"] },
  shell_bg_kill: { title: "停止后台进程", icon: "stop", kind: "process", subject: ["进程 PID"] },
  dispatch: { title: "派发子任务", icon: "chat", kind: "subagent", subject: ["任务", "代理"] },
  bg_status: { title: "查看子任务状态", icon: "chat", kind: "subagent", subject: ["任务 ID"] },
  bg_cancel: { title: "取消子任务", icon: "stop", kind: "subagent", subject: ["任务 ID"] },
  bg_reply: { title: "回复子任务", icon: "chat", kind: "subagent", subject: ["任务 ID"] },
  task_create: { title: "创建任务", icon: "check", kind: "task", subject: ["目标", "任务数量"] },
  task_update: { title: "更新任务", icon: "check", kind: "task", subject: ["更新数量"] },
  ask_user: { title: "询问用户", icon: "chat", kind: "plan", subject: ["问题"] },
  enter_plan_mode: { title: "请求进入计划模式", icon: "thought", kind: "plan", subject: ["原因"] },
  exit_plan_mode: { title: "提交计划确认", icon: "thought", kind: "plan", subject: [] },
  install_skill: { title: "安装技能", icon: "tool", kind: "installation", subject: ["来源"] },
  install_mcp_server: { title: "安装 MCP 服务器", icon: "plug", kind: "installation", subject: ["服务器"] },
  enter_worktree: { title: "进入工作树", icon: "folder", kind: "worktree", subject: ["工作树"] },
  exit_worktree: { title: "退出工作树", icon: "folder", kind: "worktree", subject: ["退出方式"] },
  sleep: { title: "等待", icon: "history", kind: "wait", subject: ["时长"] },
  describe_image: { title: "识别图片", icon: "file", kind: "image", subject: ["图片", "图片引用"] },
  compact: { title: "整理上下文", icon: "history", kind: "context", subject: ["已替换", "保留"] },
}

export function toolPresentation(name: string): { title: string; icon: string; kind: string } {
  const entry = Object.hasOwn(known, name) ? known[name] : undefined
  if (entry) return { title: entry.title, icon: uiIcon(entry.icon), kind: entry.kind }
  if (name.startsWith("MCP · ") || name.startsWith("mcp__")) return { title: name.replace(/^MCP · /, ""), icon: uiIcon("plug"), kind: "mcp" }
  return { title: name, icon: uiIcon("tool"), kind: "tool" }
}

function actionTitle(title: string, verb: string, status: ActivityStatus): string {
  switch (status) {
    case "running": return `正在${verb}`
    case "completed": return `已${verb}`
    case "failed": return `${title}失败`
    case "declined": return `已拒绝${title}`
    case "interrupted": return `已停止${title}`
    case "incomplete": return title === "加载技能" ? "技能加载未完成" : `${title}未完成`
  }
}

/** Only use the Host's whitelisted projection, never raw tool arguments or output. */
export function activityTitle(message: ActivityMessage): string {
  if (message.role === "reasoning") return message.summary.trim() || (message.status === "running" ? "正在思考" : "思考过程")
  const entry = Object.hasOwn(known, message.label) ? known[message.label] : undefined
  if (!entry) {
    // MCP identity appears once, regardless of whether the call is live or restored from history.
    return `${actionTitle("调用工具", "调用工具", message.status)} ${toolPresentation(message.label).title}`
  }
  const context = message.details?.code || message.details?.fields.filter(field => entry.subject.includes(field.label)).map(field => field.value).filter(Boolean).join("、") || ""
  const subject = context.replace(/\s+/g, " ").trim()
  const verb = !subject && message.label === "read_files" ? entry.title : entry.verb ?? entry.title
  return [actionTitle(entry.title, verb, message.status), subject].filter(Boolean).join(" ")
}
