import { displayPath } from "../resources/filePresentation.ts"
import type { ToolDetails } from "../shared/messages.ts"
import { projectTaskDetails } from "./taskDetails.ts"

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
const text = (value: unknown): string => typeof value === "string" ? value.slice(0, 8000) : ""
const choice = (value: unknown, choices: Record<string, string>): string => Object.hasOwn(choices, text(value)) ? choices[text(value)]! : ""
const integer = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null
// Core read_files alone also accepts numeric strings for offset / limit.
const lineNumber = (value: unknown): number | null => integer(typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value)
const redact = (value: string): string => value.replace(/((?:token|password|api_key|authorization)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s;]+)/gi, "$1[已隐藏]")
function safeUrl(value: string): string {
  try {
    const url = new URL(value)
    if (!["http:", "https:"].includes(url.protocol)) return ""
    url.username = ""; url.password = ""
    for (const key of new Set(url.searchParams.keys())) if (/token|password|secret|key|authorization|signature/i.test(key)) url.searchParams.set(key, "[已隐藏]")
    url.hash = ""
    return url.toString()
  } catch { return "" }
}

/** Core 0.8.44 input projection shared by live calls and schema 13 history.
 * Only explicitly supported fields cross the Host boundary; output stays in the output panel.
 * This is stateless: no request, result, or session data is cached here.
 */
export function projectToolDetails(name: string, input: unknown, cwd: string): ToolDetails | null {
  const value = object(input)
  if (!value) return null
  const fields: { label: string; value: string }[] = []
  const add = (label: string, value: string) => { if (value && fields.length < 50) fields.push({ label, value }) }
  const field = (label: string, key: string) => add(label, text(value[key]))
  const number = (label: string, key: string, unit = "") => { const n = integer(value[key]); if (n !== null) add(label, `${n}${unit}`) }
  const flag = (label: string, key: string) => { if (typeof value[key] === "boolean") add(label, value[key] ? "是" : "否") }
  const path = (label: string, key: string) => { if (text(value[key])) add(label, displayPath(cwd, text(value[key]))) }
  const result = (kind: Exclude<ToolDetails["kind"], "task">, code: string | null = null): ToolDetails => ({ kind, fields, code })
  switch (name) {
    case "skill": {
      const skill = value.name
      if (typeof skill !== "string" || !skill.trim() || skill !== skill.trim() || skill.length > 256 || skill.includes("/") || skill.includes("\\") || [...skill].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return null
      add("技能", skill)
      const separator = skill.indexOf(":")
      if (separator > 0 && separator < skill.length - 1) add("插件", skill.slice(0, separator))
      return result("skill")
    }
    case "run_bash":
      number("超时", "timeout", " 秒"); flag("后台运行", "background")
      return result("command", redact(text(value.command)))
    case "verify":
      return result("command", redact(text(value.command)))
    case "read_files": {
      if (value.files !== undefined && value.path !== undefined) return null
      const files = value.files === undefined ? [value] : Array.isArray(value.files) ? value.files : []
      for (const entry of files.slice(0, 50)) {
        const file = object(entry)
        if (!file || !text(file.path)) continue
        const offset = lineNumber(file.offset), limit = lineNumber(file.limit)
        const range = offset !== null && offset > 0 && limit !== null && limit > 0 ? `第 ${offset}–${offset + limit - 1} 行` : offset !== null && offset > 0 ? `从第 ${offset} 行起` : limit !== null && limit > 0 ? `前 ${limit} 行` : ""
        add("文件", `${displayPath(cwd, text(file.path))}${range ? `（${range}）` : ""}${file.force === true ? " · 强制重读" : ""}`)
      }
      flag("强制重读", "force")
      return fields.some(field => field.label === "文件") ? result("file") : null
    }
    case "write_file":
    case "edit_file":
    case "multi_edit":
    case "patch_file": {
      path("文件", "path")
      if (name === "edit_file") flag("替换全部匹配", "replace_all")
      if (name === "multi_edit" && Array.isArray(value.edits)) add("修改数量", `${value.edits.length} 处`)
      if (name === "patch_file") {
        const start = integer(value.start_line), count = integer(value.old_line_count)
        if (start !== null && start > 0 && count !== null) add("目标范围", count === 0 ? `第 ${start} 行前插入` : `第 ${start}–${start + count - 1} 行`)
      }
      return fields.length ? result("file") : null
    }
    case "grep":
    case "glob":
    case "search_and_read":
      field("查询", "pattern"); path("范围", "path")
      if (name !== "glob") field("匹配文件", "glob")
      if (name === "grep") {
        const modes: Record<string, string> = { files_with_matches: "匹配文件", content: "匹配内容", count: "匹配次数" }
        add("输出", choice(value.output_mode, modes))
        number("前文", "-B", " 行"); number("后文", "-A", " 行"); number("上下文", "-C", " 行")
        number("跳过", "offset", " 条"); number("结果上限", "head_limit", " 条"); flag("显示行号", "-n")
      }
      if (name === "search_and_read") { number("最多读取", "top_k", " 个文件"); number("上下文", "context_lines", " 行") }
      return result("search")
    case "list_dir":
      path("目录", "path"); number("目录深度", "max_depth", " 层"); flag("显示隐藏文件", "show_hidden")
      return result("file")
    case "web_search":
    case "tool_search":
      field("查询", "query")
      return result("search")
    case "web_fetch":
      add("地址", safeUrl(text(value.url))); number("字符上限", "max_chars")
      return result("web")
    case "shell_bg_list":
      add("范围", "当前工作区的运行中进程")
      return result("process")
    case "shell_bg_read":
    case "shell_bg_kill":
      number("进程 PID", "pid")
      if (name === "shell_bg_read") { number("日志起点", "since_offset", " 字节"); field("日志过滤", "filter") }
      return result("process")
    case "dispatch":
      field("任务", "label"); field("代理", "agent")
      add("模式", text(value.agent) ? "持续协作" : choice(value.mode, { oneshot: "单次任务", supervised: "持续协作" }))
      field("执行权限", "execution_profile")
      // subagent protocol events supply kind; dispatch tool calls supply mode / agent instead.
      field("类型", "kind")
      return result("subagent")
    case "bg_status":
    case "bg_cancel":
    case "bg_reply":
      field("任务 ID", "task_id")
      if (name === "bg_status" && value.task_id === undefined) add("范围", "本会话的全部子任务")
      if (name === "bg_reply") { field("问题 ID", "question_id"); field("消息", "message") }
      return result("subagent")
    case "task_create":
    case "task_update":
      return projectTaskDetails(name, value)
    case "ask_user":
      if (Array.isArray(value.questions)) for (const entry of value.questions.slice(0, 4)) {
        const question = object(entry)
        if (!question) continue
        add("问题", [text(question.header), text(question.question)].filter(Boolean).join(" · "))
        if (Array.isArray(question.options)) add(question.multiSelect === true ? "选项（多选）" : "选项（单选）", question.options.flatMap(option => text(object(option)?.label) ? [text(object(option)?.label)] : []).slice(0, 10).join("、"))
      }
      return result("plan")
    case "enter_plan_mode":
      field("原因", "reason")
      return result("plan")
    case "exit_plan_mode":
      field("计划", "plan")
      return result("plan")
    case "install_skill": {
      const source = text(value.source)
      add("来源", source.startsWith("git+https://") ? `git+${safeUrl(source.slice(4))}` : /^https?:/.test(source) ? safeUrl(source) : source ? displayPath(cwd, source) : "")
      add("安装范围", choice(value.scope, { user: "当前用户", project: "当前项目" }))
      flag("覆盖同名技能", "force")
      add("生效条件", "安装成功后需重启 CodeM")
      return result("installation")
    }
    case "install_mcp_server":
      field("服务器", "name"); field("传输方式", "transport")
      add("地址", safeUrl(text(value.url)))
      // Do not forward args, env or headers: these may carry credentials.
      path("启动程序", "command")
      add("生效条件", "安装成功后需重新加载 MCP 或开启新会话")
      return result("installation")
    case "enter_worktree":
      path("工作树", "name")
      return result("worktree")
    case "exit_worktree":
      add("退出方式", choice(value.action, { keep: "保留工作树和分支", remove: "删除工作树和分支" }))
      flag("丢弃更改", "discard_changes")
      return result("worktree")
    case "sleep":
      number("时长", "seconds", " 秒")
      return result("wait")
    case "describe_image":
      if (value.image_ref !== undefined && value.file_path !== undefined) return null
      path("图片", "file_path"); path("图片引用", "image_ref"); field("关注内容", "question")
      return result("image")
    case "compact":
      number("已替换", "replaced", " 条记录"); number("保留", "kept", " 条记录")
      return result("context")
    default: {
      if (!name.startsWith("mcp__") && !name.startsWith("MCP · ")) return null
      const tool = name.replace(/^MCP · /, "")
      const qualified = /^mcp__(.+?)__(.+)$/.exec(tool)
      if (qualified) { add("服务器", qualified[1]!); add("工具", qualified[2]!) }
      else add("工具", tool)
      return result("mcp")
    }
  }
}
