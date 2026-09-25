import type { AppServerHost, AppServerHostEvent } from "@codem/app-server"

export interface ApiEntry {
  page: string
  signature: string
  purpose: string
  boundary: string
  example: string | null
}
const entry = (page: string, signature: string, purpose: string, boundary: string, example: string | null = null): ApiEntry => ({ page, signature, purpose, boundary, example })
type HostMethod = { [K in keyof AppServerHost]: AppServerHost[K] extends (...args: never[]) => unknown ? K : never }[keyof AppServerHost]
// Callable public members only; hasActiveWork is a separately documented getter.
export const hostReference = {
  onEvent: entry("execution", "onEvent(listener) → unsubscribe", "订阅校验后的 Host 事件", "先订阅再发送；视图退出时移除监听。", "conversation"),
  prepareConnection: entry("architecture", "prepareConnection(cwd) → Promise<void>", "准备工作区连接", "按规范化 cwd 复用；认证失败会拒绝。", "catalogs"),
  startThread: entry("sessions", "startThread(cwd, settings) → Promise<string>", "创建会话，返回 Core threadId", "settings 包含模型、强度、权限、工作模式和目录。", "conversation"),
  resumeThread: entry("sessions", "resumeThread(cwd, threadId, settings) → Promise<void>", "恢复并订阅既有会话", "先验证工作区；历史正文另读 JSONL。", "sessions"),
  startTurn: entry("execution", "startTurn({ cwd, threadId, submissionId, text, skillName?, attachments? }) → Promise<string>", "提交轮次，返回 turnId", "回执不等于完成；Skill 与附件不能组合。", "conversation"),
  compactThread: entry("sessions", "compactThread(cwd, threadId) → Promise<string>", "发起压缩控制轮次", "Core 0.8.47 有终态缺陷；不能将 ready 当成功。"),
  rewindThread: entry("sessions", "rewindThread(cwd, threadId) → Promise<string>", "发起回退控制轮次", "通过 rewind 交互选择检查点；等待 turn-completed。"),
  steerTurn: entry("execution", "steerTurn({ cwd, threadId, submissionId, text }) → Promise<void>", "为活跃轮次追加纯文本指令", "Host 绑定 expectedTurnId；失败保留用户草稿。", "control"),
  interruptTurn: entry("execution", "interruptTurn(cwd, threadId) → Promise<void>", "请求停止当前轮次", "需要活跃 turnId；回执后仍等待 turn-completed。", "sideQuestion"),
  cancelBackgroundTask: entry("resources", "cancelBackgroundTask(cwd, threadId, taskId) → Promise<status>", "取消 Core 后台任务", "status 为 cancelled / notFound / noop；taskId 不是 PID。", "resources"),
  startSideQuestion: entry("execution", "startSideQuestion(cwd, threadId, operationId, question) → Promise<string>", "创建独立旁问，返回 sideQuestionId", "当前 Host 要求主轮次与旁问均空闲。", "sideQuestion"),
  cancelSideQuestion: entry("execution", "cancelSideQuestion(cwd, threadId, sideQuestionId) → Promise<void>", "请求取消旁问", "等待 side-question-completed 确定结果。", "sideQuestion"),
  respondToInteraction: entry("approvals", "respondToInteraction(requestId, response) → Promise<void>", "提交用户决策", "响应 kind 必须匹配；拒绝失效归属，以及 Core 未提供的审批选项、检查点、回退范围或问答选项。", "approval"),
  readModes: entry("modes", "readModes(cwd, threadId) → Promise<AppServerModeState>", "读取线程模式与 revision", "只接受当前订阅线程；不能用旧快照覆盖新状态。", "sessions"),
  setModes: entry("modes", "setModes({ cwd, threadId, expectedRevision, permissionMode?, workMode? }) → Promise<AppServerModeState>", "以用户看到的修订号更新模式", "至少提供一种模式；冲突不自动重试。", "modes"),
  listThreads: entry("sessions", "listThreads(cwd, cursor?) → Promise<{ threads, nextCursor, total }>", "分页查询持久会话目录", "cursor 为字符串；nextCursor=null 时结束。", "snapshots"),
  readThread: entry("sessions", "readThread(cwd, threadId) → Promise<AppServerThreadDetail>", "读取会话详情及归属", "变更前核实 cwd；不能信任界面传来的任意 ID。", "sessions"),
  listModels: entry("modes", "listModels(cwd) → Promise<CodemModelCatalog>", "读取模型目录与当前模型", "按连接使用目录，不硬编码其他产品的模型。", "catalogs"),
  listSkills: entry("extensions", "listSkills(cwd, threadId?) → Promise<readonly AppServerSkillSummary[]>", "读取当前技能目录", "连接变化或 skills/changed 后让旧选择失效。", "skills"),
  readEnvironmentInfo: entry("catalogs", "readEnvironmentInfo(cwd) → Promise<AppServerEnvironmentInfo>", "读取运行环境", "返回内容留在 Host，投影后再展示。"),
  readConfigSnapshot: entry("catalogs", "readConfigSnapshot(cwd) → Promise<AppServerConfigSnapshot>", "读取经过敏感键处理的配置", "不提供 config/write；界面只展示允许的键与类型。"),
  listHooks: entry("catalogs", "listHooks(cwd) → Promise<AppServerHookList>", "读取 Hook 目录", "读取不代表支持编辑；避免下发原始命令。"),
  listPlugins: entry("catalogs", "listPlugins(cwd) → Promise<AppServerPluginList>", "读取 Core 插件目录", "App Server 目录接口与独立 plugin 管理命令不同。"),
  listPermissionProfiles: entry("catalogs", "listPermissionProfiles(cwd) → Promise<readonly AppServerPermissionProfile[]>", "读取权限档案目录", "与线程当前权限模式是不同的数据。"),
  readCoreSpaceSnapshot: entry("catalogs", "readCoreSpaceSnapshot(cwd) → Promise<AppServerCoreSpaceSnapshot>", "读取 Core 注入空间快照", "产品空间选择权威是 CLI broker，不是该快照。"),
  readModelProviderCapabilities: entry("catalogs", "readModelProviderCapabilities(cwd) → Promise<AppServerModelProviderCapabilities>", "读取 Provider 扩展能力", "不能把能力位视为实际模型操作验收。"),
  listTools: entry("extensions", "listTools(cwd, threadId) → Promise<AppServerToolList>", "读取线程工具目录", "工具列表不等于 MCP 服务健康检查。", "mcp"),
  listLoadedThreadIds: entry("sessions", "listLoadedThreadIds(cwd) → Promise<AppServerLoadedThreads>", "列出当前加载的线程", "仅实时目录，不替代持久会话列表。", "snapshots"),
  listBackgroundTerminals: entry("resources", "listBackgroundTerminals(cwd, threadId) → Promise<AppServerBackgroundTerminalList>", "读取线程后台终端", "inProgress 由 Core alive 映射；日志读取由应用负责。", "resources"),
  terminateBackgroundTerminal: entry("resources", "terminateBackgroundTerminal(cwd, threadId, processId) → Promise<void>", "终止一个属于该线程的终端", "Host 先重新列出终端验证 PID；不得按任意 PID 终止。"),
  cleanBackgroundTerminals: entry("resources", "cleanBackgroundTerminals(cwd, threadId) → Promise<AppServerBackgroundTerminalClean>", "清理线程后台终端记录", "清理结果来自 Core；操作后按需刷新目录。"),
  runShellCommand: entry("resources", "runShellCommand(cwd, threadId, command) → Promise<void>", "提交用户确认的 Shell 命令", "空回执不能证明命令执行成功，不自动重试写入。"),
  clearThread: entry("sessions", "clearThread(cwd, threadId, operationId) → Promise<string>", "清空上下文并返回新的 threadId", "校验回执身份，撤销旧线程资源；结果不明先核对。"),
  listLiveThreadTurns: entry("sessions", "listLiveThreadTurns(cwd, threadId, cursor?) → Promise<AppServerLivePage<AppServerLiveTurn>>", "分页读取实时轮次诊断快照", "cursor 为非负整数，每页 50；不是历史来源。", "snapshots"),
  listLiveThreadItems: entry("sessions", "listLiveThreadItems(cwd, threadId, cursor?) → Promise<AppServerLivePage<AppServerLiveItem>>", "分页读取实时 Item 诊断快照", "独立于 turns 游标；不能接收字符串游标。", "snapshots"),
  control: entry("sessions", "control(cwd, method, params) → Promise<Readonly<JsonObject>>", "改名、分叉、归档、解除归档、删除", "method 只允许五种 thread 操作；结果仍须按操作校验。"),
  unsubscribeThread: entry("architecture", "unsubscribeThread(cwd, threadId) → Promise<void>", "取消订阅并撤销线程状态", "会尝试停止主轮次和旁问；不是删除持久历史。"),
  close: entry("architecture", "close() → Promise<void>", "结束 Host 并回收全部连接", "重复调用返回同一 Promise；清理失败保持拒绝。", "lifecycle"),
} satisfies Record<HostMethod, ApiEntry>

export const eventReference = {
  "connection-ready": ["cwd", "可以使用工作区连接。"],
  "connection-closed": ["cwd, exit", "撤销连接事件权限，提示重连；不要自动重发写入。"],
  "thread-started": ["cwd, threadId", "绑定 Core 身份。"],
  "thread-closed": ["cwd, threadId, reason", "清理线程句柄和交互。"],
  "thread-cleared": ["threadId", "旧线程清空通知；新身份以 clearThread 回执为准。"],
  "thread-status-changed": ["threadId, status", "更新线程状态，不覆盖轮次终态。"],
  "thread-modes-updated": ["threadId, state", "按 revision 合并模式快照。"],
  "turn-started": ["threadId, turnId, submissionId", "关联提交；Core 主动轮次的 submissionId 为 null。"],
  "turn-activity": ["threadId, turnId, source", "更新活动反馈，不代表完成。"],
  "turn-completed": ["threadId, turnId, outcome, stopReason, error", "主轮次终态：completed / stopped / failed。"],
  "text-delta": ["threadId, turnId, itemId, delta", "原样追加回复文本，保留空白。"],
  "reasoning-delta": ["threadId, turnId, itemId, delta", "追加 Core 提供的思考文本。"],
  "item-started": ["threadId, turnId, item", "创建消息或工具活动项。"],
  "item-completed": ["threadId, turnId, item", "更新单项结果；不结束整个轮次。"],
  "item-output-delta": ["threadId, turnId, itemId, toolCallId, delta", "按调用标识合并工具输出。"],
  "tool-guard": ["threadId, turnId, itemId, guard", "呈现输出截断与保护状态。"],
  "file-diff": ["threadId, turnId, itemId, diff", "投影文件差异，路径处理留在 Host。"],
  "diff-updated": ["threadId, turnId, files", "更新整轮文件增删行汇总。"],
  "plan-updated": ["threadId, turnId, plan", "更新计划步骤与进展。"],
  "usage-updated": ["threadId, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens", "null 是未知，不能当零，也不能据此推算费用。"],
  "hook-completed": ["threadId, turnId, eventName, toolName, command, outcome, reason, elapsedMs", "Hook 结果不是轮次终态；原始命令不下发界面。"],
  "background-wake": ["threadId, turnId, phase, taskId", "观察 queued / started / skipped 后台唤醒。"],
  "side-question-started": ["threadId, operationId, sideQuestionId, question", "绑定旁问身份。"],
  "side-question-delta": ["threadId, sideQuestionId, delta", "追加独立的旁问答案。"],
  "side-question-completed": ["threadId, sideQuestionId, status, error", "旁问终态：completed / failed / interrupted。"],
  "interaction": ["interaction", "展示 permission / question / plan / plan-mode / rewind 对应 UI。"],
  "interaction-resolved": ["threadId, turnId, requestId, status, error", "撤销对应审批；status 为 answered / cancelled / failed。"],
  "control-changed": ["threadId, method", "按变更范围刷新目录；threadId 可以为 null。"],
  "warning": ["threadId, message", "按允许的内容展示警告，不冒充终态。"],
  "authentication-invalidated": ["message", "阻止新操作，撤销旧连接权威并重新登录。"],
  "protocol-error": ["cwd, message", "停止消费无效协议，交给应用恢复连接。"],
} satisfies Record<AppServerHostEvent["type"], readonly [string, string]>

export const apiEntries = Object.entries(hostReference).map(([name, value]) => ({ name, ...value }))
export const coverage = {
  hostMethods: apiEntries.length,
  methodsWithExamples: apiEntries.filter(item => item.example !== null).length,
  eventTypes: Object.keys(eventReference).length,
}
