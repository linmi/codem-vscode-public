import type { ActivityStatus, ChatMessage } from "../contract.ts"

interface ToolPresentation {
  title: string
  kind: string
  verb?: string
  subject: readonly string[]
}

const known: Record<string, ToolPresentation> = {
  skill: { title: "加载技能", kind: "skill", subject: ["技能"] },
  grep: { title: "搜索内容", kind: "search", subject: ["查询", "范围", "匹配文件"] },
  glob: { title: "查找文件", kind: "search", subject: ["查询", "范围"] },
  search_and_read: { title: "搜索并读取", kind: "search", subject: ["查询", "范围"] },
  list_dir: { title: "查看目录", kind: "read", subject: ["目录"] },
  run_bash: { title: "执行命令", verb: "运行", kind: "command", subject: [] },
  verify: { title: "运行验证", kind: "command", subject: [] },
  read_files: { title: "读取文件", verb: "读取", kind: "read", subject: ["文件"] },
  write_file: { title: "写入文件", verb: "写入", kind: "write", subject: ["文件"] },
  edit_file: { title: "编辑文件", verb: "编辑", kind: "write", subject: ["文件"] },
  multi_edit: { title: "批量编辑文件", kind: "write", subject: ["文件", "修改数量"] },
  patch_file: { title: "修改文件行段", kind: "write", subject: ["文件", "目标范围"] },
  web_search: { title: "搜索网页", kind: "search", subject: ["查询"] },
  web_fetch: { title: "读取网页", kind: "web", subject: ["地址"] },
  tool_search: { title: "查找工具", kind: "search", subject: ["查询"] },
  shell_bg_list: { title: "查看后台进程", kind: "process", subject: [] },
  shell_bg_read: { title: "读取后台日志", kind: "process", subject: ["进程 PID"] },
  shell_bg_kill: { title: "停止后台进程", kind: "process", subject: ["进程 PID"] },
  dispatch: { title: "派发子任务", kind: "subagent", subject: ["任务", "代理"] },
  bg_status: { title: "查看子任务状态", kind: "subagent", subject: ["任务 ID"] },
  bg_cancel: { title: "取消子任务", kind: "subagent", subject: ["任务 ID"] },
  bg_reply: { title: "回复子任务", kind: "subagent", subject: ["任务 ID"] },
  task_create: { title: "创建任务", kind: "task", subject: ["目标", "任务数量"] },
  task_update: { title: "更新任务", kind: "task", subject: ["更新数量"] },
  ask_user: { title: "询问用户", kind: "plan", subject: ["问题"] },
  enter_plan_mode: { title: "请求进入计划模式", kind: "plan", subject: ["原因"] },
  exit_plan_mode: { title: "提交计划确认", kind: "plan", subject: [] },
  compact: { title: "整理上下文", kind: "context", subject: ["已替换", "保留"] },
  install_skill: { title: "安装技能", kind: "installation", subject: ["来源"] },
  install_mcp_server: { title: "安装 MCP 服务器", kind: "installation", subject: ["服务器"] },
  enter_worktree: { title: "进入工作树", kind: "worktree", subject: ["工作树"] },
  exit_worktree: { title: "退出工作树", kind: "worktree", subject: ["退出方式"] },
  sleep: { title: "等待", kind: "wait", subject: ["时长"] },
  describe_image: { title: "识别图片", kind: "image", subject: ["图片", "图片引用"] },
}

export function toolPresentation(name: string): { title: string; kind: string } {
  const entry = Object.hasOwn(known, name) ? known[name] : undefined
  if (entry) return { title: entry.title, kind: entry.kind }
  if (name.startsWith("MCP · ") || name.startsWith("mcp__")) return { title: name.replace(/^MCP · /u, ""), kind: "mcp" }
  return { title: name, kind: "tool" }
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

const reasoningBadge: Record<ActivityStatus, string> = {
  running: "思考中",
  completed: "思考完成",
  interrupted: "思考已停止",
  incomplete: "思考未完成",
  failed: "思考失败",
  declined: "已拒绝",
}

const toolBadge: Record<ActivityStatus, string> = {
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  declined: "已拒绝",
  interrupted: "已停止",
  incomplete: "未完成",
}

/** 动作和对象分开，窄栏里对象单独省略，不把整行挤成一串。 */
export function activityHeading(message: ChatMessage): { action: string; subject: string } {
  const status = message.status ?? "completed"
  if (message.role === "reasoning") return { action: message.summary?.trim() || (status === "running" ? "正在思考" : "思考过程"), subject: "" }
  const name = message.label ?? "工具"
  const entry = Object.hasOwn(known, name) ? known[name] : undefined
  if (!entry) return { action: `${actionTitle("调用工具", "调用工具", status)} ${toolPresentation(name).title}`, subject: "" }
  const context = message.details?.code || message.details?.fields.filter((field) => entry.subject.includes(field.label)).map((field) => field.value).filter(Boolean).join("、") || ""
  const subject = context.replace(/\s+/gu, " ").trim()
  const verb = !subject && name === "read_files" ? entry.title : entry.verb ?? entry.title
  return { action: actionTitle(entry.title, verb, status), subject }
}

/** 只用 Host 白名单投影，不读原始参数。 */
export function activityTitle(message: ChatMessage): string {
  const { action, subject } = activityHeading(message)
  return [action, subject].filter(Boolean).join(" ")
}

export function activityBadge(message: ChatMessage): string {
  const status = message.status ?? "completed"
  return message.role === "reasoning" ? reasoningBadge[status] : toolBadge[status]
}

export function activityPlaceholder(message: ChatMessage): string {
  const status = message.status ?? "completed"
  if (status === "running") {
    if (message.role === "reasoning") return "正在思考…"
    return message.label === "skill" ? "正在加载技能说明…" : "等待工具输出…"
  }
  if (status === "incomplete") return "未收到完成结果。"
  return message.role === "reasoning" ? "Core 未提供可显示的思考内容。" : "无文本输出。"
}
