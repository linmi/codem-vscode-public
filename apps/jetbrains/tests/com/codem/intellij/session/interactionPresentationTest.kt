package com.codem.intellij.session

import com.codem.intellij.core.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class InteractionPresentationTest {
    private fun question(text: String, multiple: Boolean = false) = JsonValue.obj(
        "question" to JsonValue.Text(text),
        "allowsMultipleSelection" to JsonValue.Bool(multiple),
        "options" to JsonValue.ArrayValue(listOf("选项甲", "选项乙").map { JsonValue.obj("label" to JsonValue.Text(it)) }),
    )

    @Test
    fun multipleQuestionsUseOpaquePagesAndPreserveAnswersWhenGoingBack() {
        val writes = mutableListOf<String>()
        val router = InteractionRouter()
        assertTrue(router.handle(RpcRequest(RpcId.TextId("rpc-secret"), "item/tool/requestUserInput", JsonValue.obj(
            "requestId" to JsonValue.Text("raw_core_request"),
            "questions" to JsonValue.ArrayValue(listOf(question("第一题"), question("第二题", true))),
        )), RpcPeer(writes::add, {}, {}, {}), 1, "thread"))
        val first = router.panelView()!!
        assertNotEquals("raw_core_request", first.id)
        assertEquals("下一步", first.confirmLabel)
        assertEquals(listOf("choice-0", "choice-1"), first.choices.map { it.id })
        router.reply(first.id, 1, "thread", listOf("choice-1"), "补充", false)
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
        router.reply(router.panelView()!!.id, 1, "thread", listOf("choice-0", "choice-1"), "", false)
        assertNull(router.panelView())
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
        router.reply(router.panelView()!!.id, 1, "thread", listOf("choice-0"), "", false)
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
        router.revokeThread(1, "thread")
        assertNull(router.panelView())
        assertThrows(CodemError.Conflict::class.java) { router.reply(view.id, 1, "thread", listOf("choice-0"), "", false) }
        assertTrue(writes.single().contains("-32000"))
    }

    @Test
    fun foreignOrDuplicateRequestCannotReplaceCurrentInteraction() {
        val writes = mutableListOf<String>()
        val router = InteractionRouter()
        val params = JsonValue.obj("requestId" to JsonValue.Text("request"), "threadId" to JsonValue.Text("thread"), "questions" to JsonValue.ArrayValue(listOf(question("问题"))))
        val peer = RpcPeer(writes::add, {}, {}, {})
        assertFalse(router.handle(RpcRequest(RpcId.TextId("foreign"), "item/tool/requestUserInput", params), peer, 1, "other"))
        assertTrue(router.handle(RpcRequest(RpcId.TextId("first"), "item/tool/requestUserInput", params), peer, 1, "thread"))
        val first = router.panelView()
        assertFalse(router.handle(RpcRequest(RpcId.TextId("duplicate"), "item/tool/requestUserInput", params), peer, 1, "thread"))
        assertEquals(first, router.panelView())
    }
}
