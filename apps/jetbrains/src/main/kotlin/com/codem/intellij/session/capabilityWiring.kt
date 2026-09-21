package com.codem.intellij.session

/**
 * A/B 能力接线状态。域层接线不等于 Cycle 2/6/9 或真实 IDEA 准出。
 */
object CapabilityWiring {
    enum class Status {
        DomainWired,
        UiWired,
        RequestConstructorOnly,
        Unverified,
        OutOfScope,
    }

    data class Entry(val id: String, val domain: Status, val ui: Status, val note: String)

    val entries: List<Entry> = listOf(
        Entry("A01", Status.DomainWired, Status.UiWired, "登录动作进入共享 UI；无真实 IDEA/浏览器登录验证"),
        Entry("A02", Status.DomainWired, Status.UiWired, "connect/chooseSpace 已接；调用次数仅有单元/假进程证据"),
        Entry("A03", Status.DomainWired, Status.UiWired, "modes read/set 已接 ProjectSession 与 shadcn 菜单；真实 Core Unverified"),
        Entry("A04", Status.DomainWired, Status.UiWired, "send/stop/newChat 已接正式聊天壳"),
        Entry("A05", Status.DomainWired, Status.UiWired, "流式文本进入聊天壳 transcript；无真实模型展示验证"),
        Entry("A06", Status.DomainWired, Status.UiWired, "审批回包为 outcome.optionId；UI 使用当前 pendingPanel.id"),
        Entry("A07", Status.DomainWired, Status.UiWired, "问答/计划/rewind 回包对齐 Node；正式 UI 按 kind 展示"),
        Entry("A08", Status.DomainWired, Status.UiWired, "resume/older 由快照标志显示；JSONL 关闭重开 Unverified"),
        Entry("A09", Status.DomainWired, Status.UiWired, "send 接附件/选区不透明 id；无真实图片识别"),
        Entry("A10", Status.DomainWired, Status.UiWired, "DiffPresenter 窄端口 + UI 入口；本机无 IDEA，假端口可测"),
        Entry("A11", Status.DomainWired, Status.UiWired, "plan/usage/activity/diff 进入正式 UI，不当终态，无账单"),
        Entry("B01", Status.DomainWired, Status.UiWired, "manageThread 接到已有 rename/fork/archive/delete，不重写构造器"),
        Entry("B02", Status.DomainWired, Status.UiWired, "clearThread 动作接到已有七字段实现"),
        Entry("B03", Status.DomainWired, Status.UiWired, "compact/rewind 已接 UI；0.8.45 compact 终态未重测，不得把 warning 转成功"),
        Entry("B04", Status.DomainWired, Status.UiWired, "steer 动作接到已有 turn/steer"),
        Entry("B05", Status.DomainWired, Status.UiWired, "旁路提问动作已接；并发约束未用真实 Core 核实"),
        Entry("B06", Status.DomainWired, Status.UiWired, "send 接 skillName，拒绝与附件组合"),
        Entry("B07", Status.DomainWired, Status.UiWired, "shellCommand 动作接到已有实现；空回执不代表成功"),
        Entry("B08", Status.DomainWired, Status.UiWired, "额外目录进入会话并 resume；宿主选择器无 IDEA 时用注入端口"),
        Entry("B09", Status.DomainWired, Status.UiWired, "background terminal list/terminate/clean 已接 ProjectSession 与 UI"),
        Entry("B10", Status.DomainWired, Status.UiWired, "cancelBackgroundTask 已接 UI；wake/主动轮次 Unverified"),
        Entry("B11", Status.DomainWired, Status.UiWired, "tools 目录快照可加载；mcpStdio 安全存储与真实工具调用仍 Unverified"),
        Entry("B12", Status.DomainWired, Status.UiWired, "环境/配置/Hooks/插件/权限/Core 空间/Provider 目录快照已接，已脱敏"),
        Entry("B13", Status.DomainWired, Status.UiWired, "listLiveTurns 标明诊断快照，不是持久历史"),
        Entry("B14", Status.DomainWired, Status.UiWired, "skills/status/hook/warning/mode 进入快照 notice 或运行信息"),
        Entry("C01", Status.OutOfScope, Status.OutOfScope, "修改建议不在本轮"),
        Entry("C02", Status.OutOfScope, Status.OutOfScope, "行内补全等不在本轮"),
        Entry("X01", Status.OutOfScope, Status.OutOfScope, "MCP HTTP 未授权"),
        Entry("X02", Status.OutOfScope, Status.OutOfScope, "CLI 全局空间不在范围"),
        Entry("X03", Status.OutOfScope, Status.OutOfScope, "Remote Development 不声明支持"),
    )

    fun entry(id: String): Entry = entries.first { it.id == id }
}
