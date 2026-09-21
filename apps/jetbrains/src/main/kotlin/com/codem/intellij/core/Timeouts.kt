package com.codem.intellij.core

/**
 * 普通 RPC、初始化、审批等待和生成等待分开计时。
 * 本地超时只表示客户端停止等待，不表示 Core 已撤销。
 */
data class Timeouts(
    val initializeMs: Long = 5_000,
    val rpcMs: Long = 30_000,
    val approvalMs: Long = 30 * 60_000,
    val generationMs: Long = 10 * 60_000,
    val closeStageMs: Long = 2_000,
    val rpcGraceMs: Long = 1_000,
    val authStatusMs: Long = 8_000,
    val authLoginMs: Long = 10 * 60_000,
    val spaceBrokerMs: Long = 180_000,
) {
    init {
        require(initializeMs > 0 && rpcMs > 0 && approvalMs > 0 && generationMs > 0 && closeStageMs > 0) {
            "CodeM timeouts must be positive"
        }
    }

    /** 关闭总预算：stdin 关闭 + SIGTERM + SIGKILL，对照 Node 的每阶段 2 秒。 */
    val shutdownBudgetMs: Long get() = closeStageMs * 3
}
