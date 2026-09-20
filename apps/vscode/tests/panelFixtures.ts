import type { PanelView } from "../src/shared/panelTypes.ts"
const base = { backChoiceId: null, initialText: "", description: "", detail: null, multiple: false, allowText: false, confirmLabel: null }
export const panelFixtures: Record<string, PanelView> = {
  workMode: { ...base, id: "workModeFixture", kind: "workMode", title: "工作模式", choices: [{ id: "default", label: "Agent", description: "执行任务", selected: true }, { id: "plan", label: "Plan", description: "先制定计划", selected: false }] },
  permissionMode: { ...base, id: "permissionFixture", kind: "permissionMode", title: "权限模式", choices: [{ id: "default", label: "默认权限", description: "遵循 Core 默认审批策略", selected: true, icon: "hand" }, { id: "auto", label: "自动审批", description: "由 Core 自动评估工具权限", selected: false, icon: "shieldCheck" }, { id: "yolo", label: "完全访问", description: "跳过工具权限审批", selected: false, icon: "shieldAlert" }] },
  questionBack: { ...base, id: "questionBackFixture", kind: "question", title: "验证范围 · 2/2", description: "优先检查哪个尺寸？", allowText: true, confirmLabel: "提交回答", backChoiceId: "previous", choices: [{ id: "narrow", label: "窄侧栏", selected: true, description: "320px" }, { id: "wide", label: "宽面板", selected: false, description: "1000px" }] },
  space: { ...base, id: "spaceFixture", kind: "space", title: "空间", description: "切换后开始新会话，历史记录仍保留。", choices: [{ id: "team", label: "研发团队", selected: true, description: "" }, { id: "personal", label: "个人空间", selected: false, description: "" }, { id: "refresh", label: "刷新空间列表", selected: false, description: "" }] },
  model: { ...base, id: "model-fixture", kind: "model", title: "模型", description: "下一轮生效", choices: [
    { id: "auto", label: "Auto", description: "自动选择合适的模型", selected: true },
    { id: "model-one", label: "CodeM Reasoning", description: "支持图片 · 200,000 tokens", selected: false },
    { id: "model-two", label: "CodeM Fast", description: "128,000 tokens", selected: false },
  ] },
  effort: { ...base, id: "effortFixture", kind: "effort", title: "思考强度", choices: [
    { id: "low", label: "low", description: "", selected: false },
    { id: "medium", label: "medium", description: "默认", selected: true },
    { id: "high", label: "high", description: "", selected: false },
    { id: "xhigh", label: "xhigh", description: "", selected: false },
  ] },
  approval: { ...base, id: "approval-fixture", kind: "approval", title: "允许执行命令？", description: "验证当前项目的类型检查。", detail: "pnpm typecheck", choices: [
    { id: "once", label: "仅允许这一次", description: "仅批准当前请求", selected: false },
    { id: "session", label: "本次会话允许", description: "对此操作不再询问", selected: false },
    { id: "decline", label: "拒绝", description: "拒绝并让任务继续", selected: false },
  ] },
  question: { ...base, id: "question-fixture", kind: "question", title: "实现方向 · 1/1", description: "这次优先完善哪些部分？", allowText: true, multiple: true, confirmLabel: "提交回答", choices: [
    { id: "chat", label: "聊天界面", description: "输出、代码块与工具记录", selected: false },
    { id: "composer", label: "输入区域", description: "模型选择与附件交互", selected: false },
  ] },
  plan: { ...base, id: "plan-fixture", kind: "plan", title: "审阅计划", detail: "## 实现步骤\n\n1. 对齐消息布局。\n2. 接入真实事件。\n3. 在 VS Code 验证。", choices: [{ id: "approve", label: "同意", description: "按计划继续", selected: false }, { id: "decline", label: "拒绝", description: "", selected: false }] },
}
