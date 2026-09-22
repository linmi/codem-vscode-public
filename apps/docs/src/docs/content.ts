export interface DocSection {
  title: string
  body: string
  items?: readonly string[]
  code?: string
}
export interface DocPage {
  id: string
  title: string
  english: string
  group: "开始" | "核心能力" | "参考"
  description: string
  icon: "overview" | "start" | "architecture" | "stream" | "sessions" | "approval" | "modes" | "skills" | "catalogs" | "history" | "examples" | "limits"
  methods?: readonly string[]
  sections: readonly DocSection[]
}
export const pages: readonly DocPage[] = [
  { id: "overview", title: "能力总览", english: "Overview", group: "开始", icon: "overview",
    description: "把 CodeM 的 Agent 能力，接入你的应用。", sections: [] },
  { id: "quickstart", title: "快速开始", english: "Quick start", group: "开始", icon: "start",
    description: "从创建 Host 到发出第一条消息，了解一次完整接入需要什么。",
    sections: [
      { title: "准备运行环境", body: "@codem/app-server 是当前仓库内的私有 workspace 包，需要 Node.js ≥ 22.23.2 与 pnpm 12.4.1。由应用 Host 在 Node 侧使用，不能直接导入浏览器。",
        items: ["在仓库内的消费包声明 @codem/app-server: workspace:*，然后在根目录运行 pnpm install。", "开发时从已安装依赖解析 runtime；打包后的编辑器使用 resolveBundledAppServerRuntime。", "应用先完成工作区信任检查。未登录时通过 startAppServerLogin 展示系统浏览器授权，再校验 completed；关闭登录窗口时调用 login.cancel()。"] },
      { title: "创建应用 Host", body: "运行时解析会检查平台与锁定版本。认证由 CLI broker 提供，应用负责登录入口；不要自行读写凭据文件。", code: "connect" },
      { title: "开始一段对话", body: "先订阅事件，再发送消息。startTurn 返回轮次 ID 仅表示提交成功；请将 interaction 交给用户决策，并处理连接失败。", code: "conversation" },
      { title: "接收输出与收尾", body: "逐段消费文本，在 turn-completed 中区分成功、停止和失败。事件监听归当前视图所有；Host 归应用会话所有。", code: "streaming",
        items: ["重复发送必须等待当前轮次结束；执行中补充指令使用 steerTurn。", "离开视图时移除监听；切换会话时撤销旧事件归属并取消旧订阅。", "应用退出时 await host.close()；不要在 startTurn 回执后立即关闭 Host。"] },
    ] },
  { id: "architecture", title: "架构与边界", english: "Architecture", group: "开始", icon: "architecture",
    description: "界面、应用 Host 和 Core 各自负责什么。",
    sections: [
      { title: "应用界面 → 应用 Host → Core", body: "浏览器或 Webview 只消费安全的显示快照。Node 应用 Host 通过 @codem/app-server 管理连接，再通过 stdio 与 Core App Server 通信。",
        items: ["应用：工作区信任、平台权限、文件选择、凭据保护、交互和状态持久化。", "@codem/app-server：运行时分发与完整性校验、JSON-RPC、事件 DTO、连接和订阅生命周期。", "Core：拥有 threadId 和 turnId，执行 Agent、工具和审批协议，并写入持久历史。", "@codem/history：只读 Core JSONL schema 13，恢复可展示的历史消息。"] },
      { title: "连接的生命周期", body: "AppServerHost 按规范化绝对 cwd 复用长期 Core 子进程。权限模式属于线程，不作为第二个连接键。",
        items: ["初始化依次完成 initialize / initialized；请求与回执由 RPC 层关联。", "认证与目录读取由应用的连接事务协调；不要让多个层级重复初始化。", "close() 可重复调用，等待同一关闭结果。建立后的连接有界清理，必要时升级到 SIGTERM / SIGKILL。"] },
      { title: "界面可见的数据", body: "下发经过校验与投影的数据，以及应用生成的不透明句柄。原始协议帧、密钥、任意本地路径不得直接交给界面。" },
    ] },
  { id: "execution", title: "对话与流式执行", english: "Conversation & streaming", group: "核心能力", icon: "stream",
    description: "发送消息、流式消费结果，在执行中补充指令或停止。",
    methods: ["startTurn", "steerTurn", "interruptTurn", "startSideQuestion", "cancelSideQuestion"],
    sections: [
      { title: "一次轮次的完整过程", body: "消息以 submissionId 关联用户提交，Core 分配 turnId。文本、思考、工具、文件变化与计划进展陆续到达，最终由 turn/completed 决定终态。", code: "streaming" },
      { title: "执行中补充指令", body: "steerTurn 追加到正在执行的轮次。Host 传入 expectedTurnId，并验证 turnId / submissionId 回执，避免把新指令写入其他轮次。", code: "control" },
      { title: "停止、旁问与附件", body: "停止与取消的 RPC 回执都不等于执行结束。等待对应完成事件，再恢复交互。",
        items: ["旁问使用独立的 sideQuestionId 与事件；当前 Host 不允许与主轮次同时执行。", "普通输入支持本地图片、文件和目录附件。应用先验证访问范围，不能接收界面提供的任意路径。", "回复与思考的空格、制表符、换行必须原样保留；空字符串增量是合法空操作。", "background-wake 后 Core 可以主动启动轮次，此时 submissionId 为 null。"] },
    ] },
  { id: "sessions", title: "会话管理", english: "Threads & lifecycle", group: "核心能力", icon: "sessions",
    description: "创建、恢复与管理会话，让每次操作都归属于正确的工作区。",
    methods: ["startThread", "resumeThread", "listThreads", "readThread", "control", "clearThread", "unsubscribeThread"],
    sections: [
      { title: "恢复一个已有会话", body: "从当前工作区的列表选择 threadId，读取详情确认归属，再恢复连接与模式。历史正文通过独立的只读历史包恢复。", code: "sessions" },
      { title: "会话操作", body: "control 封装 thread/name/set、thread/fork、thread/archive、thread/unarchive、thread/delete。执行前应核实目标工作区、展示作用对象，并对删除等操作取得用户确认。",
        items: ["clearThread 返回新的 threadId；撤销旧身份和相关句柄，不能继续复用旧线程。", "compactThread / rewindThread 是控制轮次，仍依赖 turn-completed。", "回退选择来自 Core 提供的检查点和 code / conversation / both 范围。", "写入结果不明时先核对状态，禁止自动重试。"] },
      { title: "列表与实时快照", body: "listThreads 使用字符串游标；listLiveThreadTurns / listLiveThreadItems 使用数字偏移量，每页 50 条。两者用途和游标不能混用，实时快照也不能替代持久历史。" },
    ] },
  { id: "approvals", title: "审批与用户问答", english: "Human in the loop", group: "核心能力", icon: "approval",
    description: "把命令、文件、计划和问答中的关键决策交回用户。",
    methods: ["onEvent", "respondToInteraction"],
    sections: [
      { title: "接收交互请求", body: "interaction 事件包含 permission、question、plan、plan-mode 或 rewind。应用渲染对应控件，保留 requestId、threadId、turnId 的归属，等待用户作出选择。" },
      { title: "提交用户选择", body: "审批选项必须来自当前请求，不能猜测 optionId 或自动选第一个。同意、拒绝、取消和过期必须保持不同语义。", code: "approval" },
      { title: "撤销过期交互", body: "收到 interaction-resolved、轮次结束或上下文切换后，撤销旧控件。Host 会再次校验响应归属；失败时清楚展示结果，不把请求转发给新会话。",
        items: ["用户问答支持多题、选择项和自由文字，以及明确取消。", "计划审批支持 approved 和反馈文本；计划模式审批使用独立响应类型。", "回退仅能提交当前请求中的 checkpointId 和允许的模式。"] },
    ] },
  { id: "modes", title: "模型与运行模式", english: "Models & modes", group: "核心能力", icon: "modes",
    description: "从连接目录选择模型，以修订号保护用户看到的模式状态。",
    methods: ["listModels", "readModes", "setModes"],
    sections: [
      { title: "模型由目录决定", body: "通过 listModels 获取当前连接可用的模型与强度。启动或恢复线程时传入 AppServerThreadSettings；选择器打开本身不应重复创建 Core 或拉取目录。" },
      { title: "切换到计划模式", body: "用用户实际看到的 revision 作为 expectedRevision。发生冲突时展示最新状态，让用户重新决定。", code: "modes" },
      { title: "两个边界的命名", body: "线程初始设置中的 workMode 为 default / plan；setModes 的工作模式为 normal / plan。保持各自契约，不将它们当成可互换字符串。",
        items: ["权限模式是线程状态；读取严格的 AppServerModeState，保留 permission epoch。", "消费 thread-modes-updated 广播；旧修订不能覆盖更新的快照。", "运行中的设置入口应遵循应用的交互约束，不能绕过冲突验证。"] },
    ] },
  { id: "extensions", title: "Skills 与工具", english: "Skills & tools", group: "核心能力", icon: "skills",
    description: "调用结构化技能，连接 MCP 工具，观察终端与后台任务。",
    methods: ["listSkills", "listTools", "runShellCommand", "listBackgroundTerminals", "cancelBackgroundTask"],
    sections: [
      { title: "选择并调用 Skill", body: "Skill 名称来自当前 Core 目录，通过 skillName 与 text 提交原生结构化输入。不要把 slash 文本当成原生 Skill 调用。", code: "skills" },
      { title: "MCP 与工具目录", body: "AppServerMcpServer 支持 stdio 的 command、args 与 env。通过线程设置传入；凭据与路径留在应用 Host。listTools 返回工具目录，不代表每个 MCP 服务都通过健康检查。" },
      { title: "Shell 与后台资源", body: "runShellCommand 提交手动命令；空回执只表示收到请求，不证明命令执行成功。后台终端以 processId 管理，后台任务以 taskId 管理。",
        items: ["后台终端支持列出、终止、清理；日志读取与安全展示是应用平台能力。", "cancelBackgroundTask 取消任务，不能把 taskId 当作操作系统 PID。", "skills/changed 或切换连接时，清理旧目录和旧技能选择。"] },
    ] },
  { id: "catalogs", title: "目录与空间", english: "Catalogs & spaces", group: "核心能力", icon: "catalogs",
    description: "了解当前连接的模型、配置和扩展，并显式绑定工作空间。",
    methods: ["listModels", "listSkills", "listHooks", "listPlugins", "readConfigSnapshot", "readCoreSpaceSnapshot"],
    sections: [
      { title: "读取连接级目录", body: "模型、Skills、Hooks、插件、权限档案、环境及 Provider 能力均有 Host 读取入口。只在需要时读取，按连接保存展示状态。", code: "catalogs" },
      { title: "空间选择", body: "空间列表和启动材料通过 CLI 的临时 credential broker 获取。prepareInitialAppServerSpace 返回 prepared 或 selection-required；需要选择时先关闭 broker，用户选择后重新认证并准备。",
        items: ["通过 AppServerHost.prepareSpace 注入已验证的启动材料。", "界面只接收 projectKey / displayName；managed directory 路径留在 Host。", "应用切换本连接空间，与 commitAppServerSpace 修改 CLI 全局选择是不同操作。"] },
      { title: "只读信息的范围", body: "读取配置不代表能够写入配置；列出插件或 Hooks 也不代表提供安装和编辑接口。配置展示仅投影允许的键名与类型，不能原样暴露配置值。" },
    ] },
  { id: "history", title: "历史与恢复", english: "Durable history", group: "核心能力", icon: "history",
    description: "从 Core 持久记录恢复对话，与实时事件保持清晰分工。",
    methods: ["@codem/history · readSessionHistory"],
    sections: [
      { title: "唯一的持久来源", body: "@codem/history 只读 Core JSONL schema 13，重放用户提交、工具关联、清空和回退语义。App Server 的 turns/items 实时快照是诊断信息，不能作为历史正文的兜底来源。" },
      { title: "恢复的时机", body: "空闲会话重新打开时，从持久投影恢复视图。实时执行中不以 JSONL 快照覆盖流式内容；控制轮次完成后重新读取历史，包括被中断的控制操作。" },
      { title: "失败与分页", body: "应用先验证工作区信任与认证，再提供与 Core 一致的 sessionsRoot、cwd、threadId。游标绑定文件身份及修订，文件被修改时重新打开。",
        items: ["历史读取失败时保留现有视图并允许重试，不切换到第二份记录。", "界面仅提供 threadId 与不透明游标，不提供本地文件路径。", "取消、切换会话、空间变化时丢弃旧请求结果。"] },
    ] },
  { id: "examples", title: "参考示例", english: "Recipes", group: "参考", icon: "examples",
    description: "经过当前 workspace 类型检查的 TypeScript 片段，按需接入你的 Host。",
    sections: [
      { title: "创建连接宿主", body: "输入可解析 Core / CLI 的绝对包路径；使用者负责工作区信任、登录 UI 和最终关闭。", code: "connect" },
      { title: "发送第一条消息", body: "将事件交给应用控制器，保留监听直到视图退出，并处理审批和连接失败。", code: "conversation" },
      { title: "在当前轮次补充指令", body: "适用于执行期间的修正，不创建新的轮次。", code: "control" },
      { title: "响应权限审批", body: "用户选择是必要输入；不包含自动批准策略。", code: "approval" },
    ] },
  { id: "limitations", title: "支持边界", english: "Support & limitations", group: "参考", icon: "limits",
    description: "区分已封装的能力、应用职责和仍需实测的限制。",
    sections: [
      { title: "明确不支持", body: "当前契约未提供配置写入与 MCP HTTP；网页不会为它们提供可执行入口。",
        items: ["Skill 结构化输入不能同时携带附件。", "当前 Host 不支持主轮次与旁问同时运行。", "浏览器不能直接启动 stdio Core，需要具备 Node 能力的应用 Host。"] },
      { title: "需要注意的回执", body: "turn/start、停止和 Shell 的 RPC 回执都不能作为任务成功证据。主轮次只认 turn/completed，旁问只认 sideQuestion/completed。" },
      { title: "版本与验收证据", body: "本页版本来自当前包配置，示例按当前类型检查。接口封装存在不等于所有真实操作均已验收。仓库 2026-09-22 复验记录确认 Core 0.8.47 压缩仍返回 failed/error，提示 Core settled without a terminal event。恢复 ready 不等于压缩成功；该缺陷仍需上游 Core 修复。",
        items: ["本文依据当前公开导出、Host 实现及仓库能力文档整理，不枚举隐藏接口。", "网页与默认检查不执行真实模型、登录、Shell 命令或用户数据写入。", "真实模型验收通过应用的显式 test:live 流程运行。"] },
    ] },
]
export const capabilityIds = ["execution", "sessions", "approvals", "modes", "extensions", "catalogs", "history"] as const
export function resolvePage(hash: string): DocPage | undefined {
  const id = hash.replace(/^#\/?/, "") || "overview"
  return pages.find(page => page.id === id)
}
