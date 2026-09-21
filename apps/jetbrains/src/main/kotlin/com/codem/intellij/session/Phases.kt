package com.codem.intellij.session

/** 连接阶段是互斥状态，避免独立 boolean 组合成非法组合。 */
enum class ConnectionPhase {
    Disconnected,
    Authenticating,
    PreparingSpace,
    Starting,
    Ready,
    Failed,
    Closing,
}

/** 轮次阶段。待审批不替代运行中。 */
enum class TurnPhase {
    Idle,
    Submitting,
    Running,
    Interrupting,
    Terminal,
}

data class CallBudget(
    var auth: Int = 0,
    var list: Int = 0,
    var prepare: Int = 0,
    var core: Int = 0,
    var rpc: Int = 0,
) {
    fun snapshot(): Map<String, Int> = mapOf("auth" to auth, "list" to list, "prepare" to prepare, "core" to core, "rpc" to rpc)
}

data class SessionNotice(val message: String, val recoverable: Boolean)
