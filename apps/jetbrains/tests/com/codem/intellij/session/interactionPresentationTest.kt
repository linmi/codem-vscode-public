package com.codem.intellij.session

import com.codem.intellij.core.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class InteractionPresentationTest {
    private fun question(text: String, multiple: Boolean = false) = JsonValue.obj(
        "question" to JsonValue.Text(text),
        "multiSelect" to JsonValue.Bool(multiple),
        "options" to JsonValue.ArrayValue(listOf("选项甲", "选项乙").map { JsonValue.obj("label" to JsonValue.Text(it)) }),
    )

    @Test
    fun obsoleteAndMalformedMultiSelectFieldsAreRejected() {
        for ((key, value) in listOf("allowsMultipleSelection" to JsonValue.Bool(true), "multi_select" to JsonValue.Bool(true), "multiSelect" to JsonValue.Text("true"))) {
            val writes = mutableListOf<String>()
            val router = InteractionRouter()
            val invalid = question("选择").copy(fields = question("选择").fields + (key to value))
            val rejection = router.handle(RpcRequest(RpcId.TextId("question"), "item/tool/requestUserInput", JsonValue.obj(
                "questions" to JsonValue.ArrayValue(listOf(invalid)),
            )), RpcPeer(writes::add, {}, {}, {}), 1, "thread")
            assertNull(router.panelView())
            assertTrue(writes.isEmpty(), "the router decides; the session writes after releasing its lock")
            rejection!!.send()
            assertTrue(JsonValue.parse(writes.single()).asObject().fields.containsKey("error"))
        }
    }

    @Test
    fun multipleQuestionsUseOpaquePagesAndPreserveAnswersWhenGoingBack() {
        val writes = mutableListOf<String>()
        val router = InteractionRouter()
        assertNull(router.handle(RpcRequest(RpcId.TextId("rpc-secret"), "item/tool/requestUserInput", JsonValue.obj(
            "requestId" to JsonValue.Text("raw_core_request"),
            "questions" to JsonValue.ArrayValue(listOf(question("第一题"), question("第二题", true))),
        )), RpcPeer(writes::add, {}, {}, {}), 1, "thread"))
        val first = router.panelView()!!
        assertNotEquals("raw_core_request", first.id)
        assertEquals("下一步", first.confirmLabel)
        assertEquals(listOf("choice-0", "choice-1"), first.choices.map { it.id })
        assertNull(router.reply(first.id, 1, "thread", listOf("choice-1"), "补充", false).reply)
        val second = router.panelView()!!
        assertNotEquals(first.id, second.id)
        assertTrue(writes.isEmpty())
        assertEquals("previous", second.backChoiceId)
        assertThrows(CodemError.Conflict::class.java) { router.reply(first.id, 1, "thread", listOf("choice-0"), "", false) }
        router.reply(second.id, 1, "thread", listOf("previous"), "", false)
        val back = router.panelView()!!
        assertEquals("补充", back.initialText)
        assertTrue(back.choices[1].selected)
        router.reply(back.id, 1, "thread", listOf("choice-0"), "更正", false)
        val submitted = router.reply(router.panelView()!!.id, 1, "thread", listOf("choice-0", "choice-1"), "", false)
        assertNull(router.panelView())
        submitted.reply!!.send()
        val answers = JsonValue.parse(writes.single()).asObject().required("result").asObject().required("answers").asArray().items
        assertEquals(2, answers.size)
        assertEquals("更正", answers[0].asObject().required("freeText").asText())
        assertEquals("选项甲", answers[0].asObject().required("selected").asArray().items.single().asText())
        assertEquals(2, answers[1].asObject().required("selected").asArray().items.size)
    }

    @Test
    fun invalidReplyReissuesUsablePanelAndRejectsRawOptions() {
        val writes = mutableListOf<String>()
        val router = InteractionRouter()
        router.handle(RpcRequest(RpcId.TextId("rpc"), "item/tool/requestApproval", JsonValue.obj(
            "options" to JsonValue.ArrayValue(listOf(JsonValue.obj("id" to JsonValue.Text("allow_once"), "label" to JsonValue.Text("允许一次")))),
        )), RpcPeer(writes::add, {}, {}, {}), 1, "thread")
        val first = router.panelView()!!
        assertThrows(CodemError.Validation::class.java) { router.reply(first.id, 1, "thread", listOf("allow_once"), "", false) }
        assertNotEquals(first.id, router.panelView()!!.id)
        assertTrue(writes.isEmpty())
        router.reply(router.panelView()!!.id, 1, "thread", listOf("choice-0"), "", false).reply!!.send()
        assertEquals("allow_once", JsonValue.parse(writes.single()).asObject().required("result").asObject().required("outcome").asObject().required("optionId").asText())
    }

    @Test
    fun replayKeepsCurrentPageUntilItsTurnEnds() {
        val writes = mutableListOf<String>()
        val router = InteractionRouter()
        router.handle(RpcRequest(RpcId.TextId("rpc"), "item/tool/requestUserInput", JsonValue.obj(
            "questions" to JsonValue.ArrayValue(listOf(question("第一题"), question("第二题"))),
        )), RpcPeer(writes::add, {}, {}, {}), 1, "thread")
        router.reply(router.panelView()!!.id, 1, "thread", emptyList(), "自由回答", false)
        val view = router.panelView()!!
        assertEquals(view, router.panelView())
        router.revokeThread(1, "thread").forEach(CoreReply::send)
        assertNull(router.panelView())
        assertThrows(CodemError.Conflict::class.java) { router.reply(view.id, 1, "thread", listOf("choice-0"), "", false) }
        assertTrue(writes.single().contains("-32000"))
    }

    /**
     * 这些请求字段一向宽松读取（与 host.ts 的严格解析不同，见 PR 说明）：无效的选项、标签与模式被跳过或退回缺省，
     * 只有没有可用选项/检查点/模式时才拒绝。
     */
    @Test
    fun requestFieldsAreReadLeniently() {
        val writes = mutableListOf<String>()
        val peer = RpcPeer(writes::add, {}, {}, {})
        val router = InteractionRouter()
        assertNull(router.handle(RpcRequest(RpcId.TextId("approval"), "item/tool/requestApproval", JsonValue.obj(
            "reason" to JsonValue.NumberValue(1.0, "1"),
            "preview" to JsonValue.obj(
                "path" to JsonValue.Text("/work/src/App.kt"),
                "diffExcerpt" to JsonValue.NumberValue(1.0, "1"),
                "command" to JsonValue.Text("pnpm check"),
            ),
            "options" to JsonValue.ArrayValue(listOf(
                JsonValue.Text("allow"),
                JsonValue.obj("label" to JsonValue.Text("no id")),
                JsonValue.obj("optionId" to JsonValue.Text(" "), "id" to JsonValue.Text("shadowed")),
                JsonValue.obj("optionId" to JsonValue.NumberValue(1.0, "1"), "id" to JsonValue.Text("allow_once"), "label" to JsonValue.Text(" ")),
                JsonValue.obj("optionId" to JsonValue.Text("reject"), "label" to JsonValue.Text("拒绝")),
            )),
        )), peer, 1, "thread"))
        val approval = router.panelView()!!
        assertEquals(listOf("allow_once", "拒绝"), approval.choices.map { it.label })
        assertEquals("", approval.description)
        assertEquals("App.kt\npnpm check", approval.detail)
        router.revokeThread(1, "thread")

        assertNull(router.handle(RpcRequest(RpcId.TextId("question"), "item/tool/requestUserInput", JsonValue.obj(
            "questions" to JsonValue.ArrayValue(listOf(JsonValue.obj(
                "id" to JsonValue.Text(" "),
                "question" to JsonValue.Text("哪个？"),
                "options" to JsonValue.ArrayValue(listOf(JsonValue.Text("甲"), JsonValue.obj("label" to JsonValue.Text(" ")), JsonValue.obj("label" to JsonValue.Text("乙")))),
            ))),
        )), peer, 1, "thread"))
        assertEquals(listOf("乙"), router.panelView()!!.choices.map { it.label })
        assertEquals("question-1", router.current()!!.questions.single().id)
        router.revokeThread(1, "thread")

        val checkpoint = JsonValue.obj("id" to JsonValue.Text("cp-1"), "label" to JsonValue.NumberValue(1.0, "1"))
        assertNull(router.handle(RpcRequest(RpcId.TextId("rewind"), "item/rewind/requestSelection", JsonValue.obj(
            "checkpoints" to JsonValue.ArrayValue(listOf(checkpoint)),
            "modes" to JsonValue.ArrayValue(listOf(JsonValue.NumberValue(1.0, "1"), JsonValue.Text("everything"), JsonValue.Text("code"))),
        )), peer, 1, "thread"))
        assertEquals(listOf("cp-1", "code"), router.panelView()!!.choices.map { it.label })
        router.revokeThread(1, "thread")

        for (params in listOf(
            JsonValue.obj("checkpoints" to JsonValue.ArrayValue(listOf(JsonValue.Text("cp-1"))), "modes" to JsonValue.ArrayValue(listOf(JsonValue.Text("code")))),
            JsonValue.obj("checkpoints" to JsonValue.ArrayValue(listOf(checkpoint)), "modes" to JsonValue.ArrayValue(listOf(JsonValue.Text("everything")))),
            JsonValue.obj("checkpoints" to JsonValue.obj(), "modes" to JsonValue.ArrayValue(listOf(JsonValue.Text("code")))),
        )) {
            assertNotNull(router.handle(RpcRequest(RpcId.TextId("rewind"), "item/rewind/requestSelection", params), peer, 1, "thread"), params.toString())
        }
        assertNotNull(router.handle(RpcRequest(RpcId.TextId("question"), "item/tool/requestUserInput", JsonValue.obj(
            "questions" to JsonValue.ArrayValue(listOf(JsonValue.Text("哪个？"))),
        )), peer, 1, "thread"))
        assertNull(router.panelView())
    }

    @Test
    fun foreignOrDuplicateRequestCannotReplaceCurrentInteraction() {
        val writes = mutableListOf<String>()
        val router = InteractionRouter()
        val params = JsonValue.obj("requestId" to JsonValue.Text("request"), "threadId" to JsonValue.Text("thread"), "questions" to JsonValue.ArrayValue(listOf(question("问题"))))
        val peer = RpcPeer(writes::add, {}, {}, {})
        assertNotNull(router.handle(RpcRequest(RpcId.TextId("foreign"), "item/tool/requestUserInput", params), peer, 1, "other"))
        assertNull(router.handle(RpcRequest(RpcId.TextId("first"), "item/tool/requestUserInput", params), peer, 1, "thread"))
        val first = router.panelView()
        assertNotNull(router.handle(RpcRequest(RpcId.TextId("duplicate"), "item/tool/requestUserInput", params), peer, 1, "thread"))
        assertEquals(first, router.panelView())
    }
}
