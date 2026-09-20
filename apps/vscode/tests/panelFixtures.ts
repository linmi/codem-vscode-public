import type { PanelView } from "../src/shared/panelTypes.ts"
const base = { backChoiceId: null, initialText: "", description: "", detail: null, multiple: false, allowText: false, confirmLabel: null }
export const panelFixtures: Record<string, PanelView> = {
  questionBack: { ...base, id: "questionBackFixture", kind: "question", title: "验证范围 · 2/2", description: "优先检查哪个尺寸？", allowText: true, confirmLabel: "提交回答", backChoiceId: "previous", choices: [{ id: "narrow", label: "窄侧栏", selected: true, description: "320px" }, { id: "wide", label: "宽面板", selected: false, description: "1000px" }] },
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
