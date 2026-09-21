package com.codem.intellij.session

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue
import com.codem.intellij.core.KnownNotifications
import com.codem.intellij.core.RpcId
import com.codem.intellij.core.RpcNotification
import com.codem.intellij.core.RpcPeer
import com.codem.intellij.core.RpcRequest
import com.codem.intellij.webview.encodeChatSnapshot
import com.codem.intellij.webview.hiddenUntilReady
import com.codem.intellij.webview.initialSnapshot
import com.codem.intellij.webview.parseViewAction
import com.codem.intellij.webview.visibleControls
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SessionTest {
    @Test
    fun firstPaintHidesConditionalEntries() {
        val snapshot = initialSnapshot()
        assertEquals("disconnected", snapshot.phase)
        assertNull(snapshot.threadId)
        assertEquals(false, snapshot.canRetry)
        assertEquals(listOf("olderMessages", "retryConnect", "resumeThread"), hiddenUntilReady())
        assertEquals(false, visibleControls(snapshot).retry)
        assertEquals(false, visibleControls(snapshot).resume)
        assertEquals(false, visibleControls(snapshot).older)
        val encoded = encodeChatSnapshot(snapshot)
        assertEquals("state", encoded.required("type").asText())
        assertEquals("disconnected", encoded.required("phase").asText())
        assertEquals(false, encoded.required("canRetry").asBoolean())
    }

    @Test
    fun projectsThinkingAndToolItemsWithoutUsingThemAsTerminal() {
        val turns = TurnAccumulator()
        turns.apply(RpcNotification("turn/started", JsonValue.obj("threadId" to JsonValue.Text("thread-1"), "turn" to JsonValue.obj("id" to JsonValue.Text("turn-1")))), "thread-1")
        turns.apply(
            RpcNotification(
                "item/reasoning/textDelta",
                JsonValue.obj("threadId" to JsonValue.Text("thread-1"), "turnId" to JsonValue.Text("turn-1"), "itemId" to JsonValue.Text("r1"), "delta" to JsonValue.Text("先查文件")),
            ),
            "thread-1",
        )
        turns.apply(
            RpcNotification(
                "item/started",
                JsonValue.obj(
                    "threadId" to JsonValue.Text("thread-1"),
                    "turnId" to JsonValue.Text("turn-1"),
                    "item" to JsonValue.obj(
                        "id" to JsonValue.Text("tool-1"),
                        "type" to JsonValue.Text("commandExecution"),
                        "status" to JsonValue.Text("inProgress"),
                        "tool" to JsonValue.Text("run_bash"),
                        "callId" to JsonValue.Text("call-1"),
                        "arguments" to JsonValue.obj("command" to JsonValue.Text("pnpm check")),
                    ),
                ),
            ),
            "thread-1",
        )
        val live = turns.liveMessages()
        assertEquals(TurnPhase.Running, turns.current?.phase)
        assertEquals("reasoning", live[0].role)
        assertEquals("running", live[0].status)
        assertEquals("先查文件", live[0].text)
        assertEquals("tool", live[1].role)
        assertEquals("run_bash", live[1].label)
        assertEquals("running", live[1].status)
        assertEquals("command", live[1].details?.kind)
        assertEquals("pnpm check", live[1].details?.code)
        turns.apply(
            RpcNotification(
                "turn/completed",
                JsonValue.obj(
                    "threadId" to JsonValue.Text("thread-1"),
                    "turn" to JsonValue.obj("id" to JsonValue.Text("turn-1"), "status" to JsonValue.Text("completed")),
                ),
            ),
            "thread-1",
        )
        assertEquals(TurnPhase.Terminal, turns.current?.phase)
        assertTrue(turns.liveMessages().isEmpty())
        assertEquals("incomplete", turns.committedMessages().single { it.role == "tool" }.status)
        assertEquals("completed", turns.committedMessages().single { it.role == "reasoning" }.status)
    }

    @Test
    fun activityIsNotTerminal() {
        val turns = TurnAccumulator()
        turns.apply(RpcNotification("turn/started", JsonValue.obj("threadId" to JsonValue.Text("thread-1"), "turn" to JsonValue.obj("id" to JsonValue.Text("turn-1")))), "thread-1")
        turns.apply(RpcNotification("turn/activity", JsonValue.obj("threadId" to JsonValue.Text("thread-1"), "turnId" to JsonValue.Text("turn-1"), "activity" to JsonValue.Text("working"))), "thread-1")
        assertEquals(TurnPhase.Running, turns.current?.phase)
        turns.apply(
            RpcNotification(
                "turn/completed",
                JsonValue.obj(
                    "threadId" to JsonValue.Text("thread-1"),
                    "turn" to JsonValue.obj("id" to JsonValue.Text("turn-1"), "status" to JsonValue.Text("completed"), "stopReason" to JsonValue.Text("EndTurn")),
                ),
            ),
            "thread-1",
        )
        assertEquals(TurnPhase.Terminal, turns.current?.phase)
        assertEquals("completed", turns.current?.terminalStatus)
    }

    @Test
    fun unknownNotificationIsNotInTheKnownSet() {
        assertTrue(KnownNotifications.isKnown("turn/activity"))
        assertTrue(!KnownNotifications.isKnown("item/unknown/noise"))
    }

    @Test
    fun unsupportedServerRequestReturnsAProtocolError() {
        val writes = mutableListOf<String>()
        val peer = RpcPeer(writes::add, {}, {}, {})
        val router = InteractionRouter()
        val accepted = router.handle(RpcRequest(RpcId.TextId("req-unknown"), "item/unknown/request", JsonValue.ObjectValue(emptyMap())), peer, 1, "thread-1")
        assertTrue(!accepted)
        assertTrue(writes.single().contains("-32601"))
        assertTrue(writes.single().contains("Unsupported client request"))
    }

    @Test
    fun crossSessionRepliesAreRejected() {
        val writes = mutableListOf<String>()
        val peer = RpcPeer(writes::add, {}, {}, {})
        val router = InteractionRouter()
        router.handle(
            RpcRequest(
                RpcId.TextId("approval-1"),
                "item/tool/requestApproval",
                JsonValue.obj("options" to JsonValue.ArrayValue(listOf(JsonValue.obj("id" to JsonValue.Text("approve"))))),
            ),
            peer,
            1,
            "thread-1",
        )
        var failed = false
        try {
            router.reply("approval-1", 2, "thread-2", listOf("approve"), "", false)
        } catch (error: CodemError) {
            failed = error.errorClass == CodemError.Class.Conflict
        }
        assertTrue(failed)
    }

    @Test
    fun revokeRespondsToStaleInteractions() {
        val writes = mutableListOf<String>()
        val peer = RpcPeer(writes::add, {}, {}, {})
        val router = InteractionRouter()
        router.handle(
            RpcRequest(
                RpcId.TextId("approval-1"),
                "item/tool/requestApproval",
                JsonValue.obj("options" to JsonValue.ArrayValue(listOf(JsonValue.obj("id" to JsonValue.Text("approve"))))),
            ),
            peer,
            1,
            "thread-1",
        )
        router.revoke(2)
        assertTrue(writes.single().contains("-32000"))
        var failed = false
        try {
            router.reply("approval-1", 1, "thread-1", listOf("approve"), "", false)
        } catch (error: CodemError) {
            failed = error.errorClass == CodemError.Class.Conflict
        }
        assertTrue(failed)
    }

    @Test
    fun sendAndPanelContractsMatchSamples() {
        parseViewAction(JsonValue.obj("type" to JsonValue.Text("send"), "text" to JsonValue.Text("hello"), "requestId" to JsonValue.Text("req-1")))
        parseViewAction(JsonValue.obj("type" to JsonValue.Text("ready")))
        parseViewAction(JsonValue.obj("type" to JsonValue.Text("showHistory")))
        parseViewAction(JsonValue.obj("type" to JsonValue.Text("signIn")))
        parseViewAction(JsonValue.obj("type" to JsonValue.Text("refreshAccount")))
        var rejected = false
        try {
            parseViewAction(JsonValue.obj("type" to JsonValue.Text("send"), "text" to JsonValue.Text("   "), "requestId" to JsonValue.Text("req-1")))
        } catch (_: CodemError) {
            rejected = true
        }
        assertTrue(rejected)
        rejected = false
        try {
            parseViewAction(JsonValue.obj("type" to JsonValue.Text("panelReply"), "id" to JsonValue.Text("approval-1"), "choiceIds" to JsonValue.ArrayValue(listOf(JsonValue.Text("approve"))), "text" to JsonValue.Text(""), "cancelled" to JsonValue.Bool(true)))
        } catch (_: CodemError) {
            rejected = true
        }
        assertTrue(rejected)
    }

    @Test
    fun interruptFailureRestoresRunning() {
        val turns = TurnAccumulator()
        turns.beginSubmit("req-1")
        turns.acceptStarted("turn-1")
        turns.markInterrupting()
        assertEquals(TurnPhase.Interrupting, turns.current?.phase)
        turns.restoreRunningIfInterrupting()
        assertEquals(TurnPhase.Running, turns.current?.phase)
    }

    @Test
    fun duplicateSubmitIsRejected() {
        val turns = TurnAccumulator()
        turns.beginSubmit("req-1")
        var failed = false
        try {
            turns.beginSubmit("req-2")
        } catch (error: CodemError) {
            failed = error.errorClass == CodemError.Class.Conflict
        }
        assertTrue(failed)
    }

    @Test
    fun completedTurnIsNotResurrectedAndDoesNotKeepOldText() {
        val turns = TurnAccumulator()
        turns.apply(RpcNotification("turn/started", JsonValue.obj("turn" to JsonValue.obj("id" to JsonValue.Text("turn-1")))), "thread-1")
        turns.apply(RpcNotification("item/agentMessage/delta", JsonValue.obj("delta" to JsonValue.Text("old answer"))), "thread-1")
        turns.apply(
            RpcNotification(
                "turn/completed",
                JsonValue.obj("turn" to JsonValue.obj("id" to JsonValue.Text("turn-1"), "status" to JsonValue.Text("completed"))),
            ),
            "thread-1",
        )
        turns.apply(RpcNotification("turn/started", JsonValue.obj("turn" to JsonValue.obj("id" to JsonValue.Text("turn-1")))), "thread-1")
        assertEquals(TurnPhase.Terminal, turns.current?.phase)
        assertEquals("old answer", turns.current?.text.toString())
        turns.apply(RpcNotification("turn/started", JsonValue.obj("turn" to JsonValue.obj("id" to JsonValue.Text("turn-2")))), "thread-1")
        assertEquals(TurnPhase.Running, turns.current?.phase)
        assertEquals("turn-2", turns.current?.turnId)
        assertEquals("", turns.current?.text.toString())
    }

    @Test
    fun submitWhileInterruptingIsRejected() {
        val turns = TurnAccumulator()
        turns.beginSubmit("req-1")
        turns.acceptStarted("turn-1")
        turns.markInterrupting()
        var failed = false
        try {
            turns.beginSubmit("req-2")
        } catch (error: CodemError) {
            failed = error.errorClass == CodemError.Class.Conflict
        }
        assertTrue(failed)
    }

    @Test
    fun approvalUsesParamsRequestIdAndCoreOutcomeShape() {
        val writes = mutableListOf<String>()
        val peer = RpcPeer(writes::add, {}, {}, {})
        val router = InteractionRouter()
        router.handle(
            RpcRequest(
                RpcId.NumberId(7),
                "item/tool/requestApproval",
                JsonValue.obj(
                    "requestId" to JsonValue.Text("approval-1"),
                    "threadId" to JsonValue.Text("thread-1"),
                    "options" to JsonValue.ArrayValue(listOf(JsonValue.obj("optionId" to JsonValue.Text("allow-once")))),
                ),
            ),
            peer,
            1,
            "thread-1",
        )
        router.reply("approval-1", 1, "thread-1", listOf("allow-once"), "", false)
        val body = JsonValue.parse(writes.single()).asObject()
        assertEquals("allow-once", body.required("result").asObject().required("outcome").asObject().required("optionId").asText())
        assertEquals(7.0, (body.required("id") as JsonValue.NumberValue).value)
    }

    @Test
    fun questionPlanAndRewindUseNodeReplyShapes() {
        val writes = mutableListOf<String>()
        val peer = RpcPeer(writes::add, {}, {}, {})
        val router = InteractionRouter()
        router.handle(
            RpcRequest(
                RpcId.TextId("q-1"),
                "item/tool/requestUserInput",
                JsonValue.obj(
                    "requestId" to JsonValue.Text("question-1"),
                    "questions" to JsonValue.ArrayValue(
                        listOf(
                            JsonValue.obj(
                                "question" to JsonValue.Text("Which files?"),
                                "options" to JsonValue.ArrayValue(listOf(JsonValue.obj("label" to JsonValue.Text("src")))),
                            ),
                        ),
                    ),
                ),
            ),
            peer,
            1,
            "thread-1",
        )
        router.reply("question-1", 1, "thread-1", listOf("src"), "", false)
        val question = JsonValue.parse(writes.removeAt(0)).asObject().required("result").asObject()
        val answer = question.required("answers").asArray().items.single().asObject()
        assertEquals("Which files?", answer.required("question").asText())
        assertEquals("src", answer.required("selected").asArray().items.single().asText())
        assertEquals(JsonValue.Null, answer.fields["freeText"])

        router.handle(
            RpcRequest(RpcId.TextId("q-2"), "item/tool/requestUserInput", JsonValue.obj(
                "requestId" to JsonValue.Text("question-2"),
                "questions" to JsonValue.ArrayValue(listOf(JsonValue.obj("question" to JsonValue.Text("Again?")))),
            )),
            peer,
            1,
            "thread-1",
        )
        router.reply("question-2", 1, "thread-1", emptyList(), "", true)
        assertEquals(true, JsonValue.parse(writes.removeAt(0)).asObject().required("result").asObject().required("cancelled").asBoolean())

        router.handle(
            RpcRequest(RpcId.TextId("p-1"), "item/plan/requestApproval", JsonValue.obj("requestId" to JsonValue.Text("plan-1"))),
            peer,
            1,
            "thread-1",
        )
        router.reply("plan-1", 1, "thread-1", listOf("approve"), "", false)
        val approved = JsonValue.parse(writes.removeAt(0)).asObject().required("result").asObject()
        assertEquals(true, approved.required("approved").asBoolean())
        assertEquals(null, approved.fields["feedback"])

        router.handle(
            RpcRequest(RpcId.TextId("p-2"), "item/plan/requestApproval", JsonValue.obj("requestId" to JsonValue.Text("plan-2"))),
            peer,
            1,
            "thread-1",
        )
        router.reply("plan-2", 1, "thread-1", listOf("reject"), "need a smaller change", false)
        val rejected = JsonValue.parse(writes.removeAt(0)).asObject().required("result").asObject()
        assertEquals(false, rejected.required("approved").asBoolean())
        assertEquals("need a smaller change", rejected.required("feedback").asText())

        router.handle(
            RpcRequest(
                RpcId.TextId("r-1"),
                "item/rewind/requestSelection",
                JsonValue.obj(
                    "requestId" to JsonValue.Text("rewind-1"),
                    "checkpoints" to JsonValue.ArrayValue(listOf(JsonValue.obj("id" to JsonValue.Text("cp-1"), "label" to JsonValue.Text("one")))),
                    "modes" to JsonValue.ArrayValue(listOf(JsonValue.Text("code"), JsonValue.Text("both"))),
                ),
            ),
            peer,
            1,
            "thread-1",
        )
        router.reply("rewind-1", 1, "thread-1", listOf("cp-1", "both"), "", false)
        val rewind = JsonValue.parse(writes.removeAt(0)).asObject().required("result").asObject()
        assertEquals("selected", rewind.required("status").asText())
        assertEquals("cp-1", rewind.required("checkpointId").asText())
        assertEquals("both", rewind.required("mode").asText())

        router.handle(
            RpcRequest(
                RpcId.TextId("r-2"),
                "item/rewind/requestSelection",
                JsonValue.obj(
                    "requestId" to JsonValue.Text("rewind-2"),
                    "checkpoints" to JsonValue.ArrayValue(listOf(JsonValue.obj("id" to JsonValue.Text("cp-1"), "label" to JsonValue.Text("one")))),
                    "modes" to JsonValue.ArrayValue(listOf(JsonValue.Text("both"))),
                ),
            ),
            peer,
            1,
            "thread-1",
        )
        router.reply("rewind-2", 1, "thread-1", emptyList(), "", true)
        assertEquals("cancelled", JsonValue.parse(writes.removeAt(0)).asObject().required("result").asObject().required("status").asText())
        assertTrue(writes.none { it.contains("choiceIds") })
    }

    @Test
    fun permissionCancelIsRejectedInsteadOfWebviewShape() {
        val writes = mutableListOf<String>()
        val peer = RpcPeer(writes::add, {}, {}, {})
        val router = InteractionRouter()
        router.handle(
            RpcRequest(
                RpcId.TextId("approval-1"),
                "item/tool/requestApproval",
                JsonValue.obj("options" to JsonValue.ArrayValue(listOf(JsonValue.obj("id" to JsonValue.Text("approve"))))),
            ),
            peer,
            1,
            "thread-1",
        )
        var failed = false
        try {
            router.reply("approval-1", 1, "thread-1", emptyList(), "", true)
        } catch (error: CodemError) {
            failed = error.errorClass == CodemError.Class.Validation
        }
        assertTrue(failed)
        assertTrue(writes.isEmpty())
    }

    @Test
    fun safeNoticeDropsPathsFramesAndSecrets() {
        assertEquals(
            "CodeM connection failed",
            SafeNotice.from(
                CodemError.Protocol(CodemError.Class.InvalidFrame, """{"jsonrpc":"2.0","method":"turn/start"} from /Users/linmi/secret"""),
                "CodeM connection failed",
            ),
        )
        assertEquals(
            "CodeM connection failed",
            SafeNotice.from(CodemError.Validation("token=sk-abc file:/tmp/key"), "CodeM connection failed"),
        )
        assertEquals(
            "CodeM is not ready",
            SafeNotice.from(CodemError.Conflict("CodeM is not ready"), "CodeM connection failed"),
        )
    }
}
