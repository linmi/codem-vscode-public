package com.codem.intellij.session

import com.codem.intellij.contracts.ContractFixtures
import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue
import com.codem.intellij.core.RpcNotification
import com.codem.intellij.core.required
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * `core/itemProjection.json` 由 TypeScript 测试与 parseAppServerItem 逐例比对；
 * 这里要求 Kotlin 推导出同样的 toolName、callId、input 与 final_answer，或同样拒绝。
 */
class TurnItemProjectionTest {
    @Test
    fun projectsEveryItemSampleLikeTheNodeHost() {
        val cases = ContractFixtures.cases("core/itemProjection.json")
        check(cases.isNotEmpty())
        for (case in cases) {
            val name = case.required("name").asText()
            val item = case.required("item").asObject()
            val expected = case.required("expected").asObject()
            when (val kind = expected.required("kind").asText()) {
                "accepted" -> {
                    val projected = CoreItemProjection.project(item)
                    assertEquals(expected.required("toolName"), projected.toolName?.let(JsonValue::Text) ?: JsonValue.Null, "$name toolName")
                    assertEquals(expected.required("callId"), projected.callId?.let(JsonValue::Text) ?: JsonValue.Null, "$name callId")
                    assertEquals(expected.required("input"), projected.input ?: JsonValue.Null, "$name input")
                    assertEquals(expected.required("finalAnswer"), projected.finalAnswer?.let(::encode) ?: JsonValue.Null, "$name finalAnswer")
                }
                "protocol-error" -> {
                    assertEquals("invalid-frame", expected.required("class").asText(), name)
                    val error = assertThrows(CodemError.Protocol::class.java, { CoreItemProjection.project(item) }, name)
                    assertEquals(CodemError.Class.InvalidFrame, error.errorClass, name)
                }
                else -> error("$name has unsupported expected kind $kind")
            }
        }
    }

    /** packages/ui toolPresentation 以 dispatch / compact 为键；旧实现给出“子任务”“整理上下文”，界面只能按未知工具展示。 */
    @Test
    fun presentsSubagentAndCompactionUnderTheSharedToolKeys() {
        val turns = running()
        item(turns, "item/started", sample("subagent-maps-to-dispatch"))
        item(turns, "item/completed", sample("context-compaction-maps-to-compact"))
        // 只带 subagentId 作为 callId 的进度，仍归入同一条派发活动。
        turns.apply(notification("item/subagent/progress", "callId" to JsonValue.Text("agent-1"), "note" to JsonValue.Text("reading files")), "thread-1")
        val live = turns.liveMessages()
        assertEquals(listOf("dispatch", "compact"), live.map { it.label })
        assertEquals("reading files", live[0].text)
        assertEquals(listOf("Review changes"), live[0].details?.fields?.filter { it.label == "任务" }?.map { it.detail })
        assertEquals("completed", live[1].status)
    }

    @Test
    fun keepsTheFinalAnswerAndCommitsItAfterTheStreamedText() {
        val turns = running()
        turns.apply(notification("item/agentMessage/delta", "itemId" to JsonValue.Text("msg-1"), "delta" to JsonValue.Text("Here is what changed.")), "thread-1")
        item(turns, "item/started", sample("tool-call-uses-protocol-tool"))
        val answer = sample("final-answer-with-artifacts")
        item(turns, "item/started", answer.copyWith("status" to JsonValue.Text("inProgress")))
        // final_answer 的结果条目与进度属于交付本身，不能变成工具活动。
        item(turns, "item/completed", JsonValue.obj("id" to JsonValue.Text("result-6"), "type" to JsonValue.Text("toolResult"), "status" to JsonValue.Text("completed"), "callId" to JsonValue.Text("call-6"), "output" to JsonValue.Text("ok")))
        turns.apply(notification("item/toolCall/progress", "itemId" to JsonValue.Text("item-6"), "message" to JsonValue.Text("delivering")), "thread-1")
        // completed 不再带参数时沿用 started 的交付与附件。
        item(turns, "item/completed", JsonValue.obj("id" to JsonValue.Text("item-6"), "type" to JsonValue.Text("toolCall"), "status" to JsonValue.Text("completed"), "tool" to JsonValue.Text("final_answer"), "callId" to JsonValue.Text("call-6")))

        val live = turns.liveMessages()
        assertEquals(listOf("turn-1:tool:item-1", "turn-1:final:item-6"), live.map { it.id })
        val reply = live.last()
        assertEquals("assistant", reply.role)
        assertEquals("Report is ready.", reply.text)
        assertTrue(reply.hasArtifacts)
        assertEquals(2, turns.current!!.finalAnswers.getValue("item-6").artifacts.size)

        complete(turns)
        val committed = turns.committedMessages()
        assertEquals(listOf("turn-1:tool:item-1", "turn-1", "turn-1:final:item-6"), committed.map { it.id })
        assertEquals("Here is what changed.", committed[1].text)
        assertTrue(committed.none { it.label == "final_answer" || it.text == "ok" || it.text == "delivering" })
    }

    @Test
    fun rejectsACompletedFinalAnswerWithoutStructuredInput() {
        val turns = running()
        val error = assertThrows(CodemError.Protocol::class.java) {
            item(turns, "item/completed", JsonValue.obj("id" to JsonValue.Text("item-9"), "type" to JsonValue.Text("toolCall"), "status" to JsonValue.Text("completed"), "tool" to JsonValue.Text("final_answer")))
        }
        assertEquals(CodemError.Class.InvalidFrame, error.errorClass)
    }

    /** 与 VS Code chatController 一致：只有两种文案，Core 的原始 activity 文本不透传到界面。 */
    @Test
    fun activityUsesOnlyTheVsCodeLabels() {
        val turns = running()
        fun activity(vararg fields: Pair<String, JsonValue>): String? {
            turns.apply(notification("turn/activity", *fields), "thread-1")
            return turns.current?.activity
        }
        assertEquals("模型正在生成", activity("source" to JsonValue.Text("provider_stream")))
        assertEquals("Core 正在处理", activity("source" to JsonValue.Text("tool"), "activity" to JsonValue.Text("compacting context")))
        assertEquals("Core 正在处理", activity("activity" to JsonValue.Text("working")))
    }

    private fun running(): TurnAccumulator =
        TurnAccumulator().also { it.apply(notification("turn/started", "turn" to JsonValue.obj("id" to JsonValue.Text("turn-1"))), "thread-1") }

    private fun complete(turns: TurnAccumulator) {
        turns.apply(notification("turn/completed", "turn" to JsonValue.obj("id" to JsonValue.Text("turn-1"), "status" to JsonValue.Text("completed"))), "thread-1")
    }

    private fun item(turns: TurnAccumulator, method: String, item: JsonValue.ObjectValue) {
        turns.apply(notification(method, "item" to item), "thread-1")
    }

    private fun notification(method: String, vararg fields: Pair<String, JsonValue>): RpcNotification =
        RpcNotification(method, JsonValue.obj("threadId" to JsonValue.Text("thread-1"), "turnId" to JsonValue.Text("turn-1"), *fields))

    private fun sample(name: String): JsonValue.ObjectValue =
        ContractFixtures.cases("core/itemProjection.json").single { it.required("name").asText() == name }.required("item").asObject()

    private fun JsonValue.ObjectValue.copyWith(vararg overrides: Pair<String, JsonValue>): JsonValue.ObjectValue =
        JsonValue.ObjectValue(LinkedHashMap(fields).apply { putAll(overrides) })

    private fun encode(answer: FinalAnswer): JsonValue = JsonValue.obj(
        "status" to JsonValue.Text(answer.status),
        "kind" to JsonValue.Text(answer.kind),
        "summary" to JsonValue.Text(answer.summary),
        "artifacts" to JsonValue.ArrayValue(answer.artifacts.map { artifact ->
            fun text(value: String?): JsonValue = value?.let(JsonValue::Text) ?: JsonValue.Null
            JsonValue.obj(
                "kind" to JsonValue.Text(artifact.kind),
                "title" to JsonValue.Text(artifact.title),
                "source" to text(artifact.source),
                "uri" to text(artifact.uri),
                "path" to text(artifact.path),
                "filename" to text(artifact.filename),
                "alt" to text(artifact.alt),
                "mime" to text(artifact.mime),
                "spec" to artifact.spec,
            )
        }),
    )
}
