package com.codem.intellij.core

/**
 * 与 `packages/contracts/core/knownNotifications.json` 逐项一致（Node `APP_SERVER_KNOWN_NOTIFICATIONS` 同样以它为准），
 * 由 KnownNotificationsContractTest 校验。未知通知必须协议失败，不能当传输噪声。
 */
object KnownNotifications {
    val methods: Set<String> = setOf(
        "warning",
        "auth/invalidated",
        "skills/changed",
        "thread/started",
        "thread/cleared",
        "thread/closed",
        "thread/archived",
        "thread/deleted",
        "thread/name/updated",
        "thread/unarchived",
        "thread/status/changed",
        "thread/mode/changed",
        "thread/tokenUsage/updated",
        "thread/sideQuestion/started",
        "thread/sideQuestion/delta",
        "thread/sideQuestion/completed",
        "serverRequest/resolved",
        "turn/started",
        "turn/activity",
        "turn/completed",
        "turn/diff/updated",
        "turn/plan/updated",
        "item/started",
        "item/completed",
        "item/agentMessage/delta",
        "item/reasoning/textDelta",
        "item/commandExecution/outputDelta",
        "item/subagent/progress",
        "item/toolCall/progress",
        "item/toolCall/guardUpdated",
        "item/fileChange/delta",
        "hook/completed",
        "backgroundTask/wakeQueued",
        "backgroundTask/wakeStarted",
        "backgroundTask/wakeSkipped",
    )

    fun isKnown(method: String): Boolean = method in methods
}
