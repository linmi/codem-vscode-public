package com.codem.intellij.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CopyOnWriteArrayList

class RpcPeerTest {
    @Test
    fun onlyCorrelatedErrorResponsesProveRequestRejection() {
        val writes = mutableListOf<String>()
        val peer = peer(writes)
        val rejected = peer.request("turn/start")
        peer.consume("""{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"invalid input"}}""")
        val rejection = assertThrows(java.util.concurrent.ExecutionException::class.java) { rejected.get() }.cause
        assertTrue(rejection is CodemError.RequestRejected)
        assertEquals("turn/start", (rejection as CodemError.RequestRejected).method)
        val uncertain = peer.request("turn/start")
        peer.close()
        val closed = assertThrows(java.util.concurrent.ExecutionException::class.java) { uncertain.get() }.cause
        assertTrue(closed is CodemError.Protocol)
        assertEquals(CodemError.Class.ConnectionClosed, (closed as CodemError).errorClass)
    }

    @Test
    fun writesJsonrpcRequestsAndRecordsOmittedResponses() {
        val writes = mutableListOf<String>()
        val peer = peer(writes)
        val future = peer.request("initialize", JsonValue.obj("clientInfo" to JsonValue.obj("name" to JsonValue.Text("test"))))
        assertTrue(writes.single().contains("\"jsonrpc\":\"2.0\""))
        val id = JsonValue.parse(writes.single()).asObject().required("id")
        peer.consume(encodeJson(JsonValue.obj("id" to id, "result" to JsonValue.obj("protocolVersion" to JsonValue.NumberValue(1.0, "1")))))
        assertEquals(1.0, (future.get().asObject().required("protocolVersion") as JsonValue.NumberValue).value)
        assertEquals(ResponseJsonrpc.Omitted, peer.responseJsonrpc)
    }

    @Test
    fun failsClosedOnUnknownAndDuplicateIds() {
        val errors = CopyOnWriteArrayList<CodemError>()
        val writes = mutableListOf<String>()
        val peer = peer(writes, errors)
        peer.consume("""{"jsonrpc":"2.0","id":99,"result":{"ok":true}}""")
        assertEquals(CodemError.Class.UnknownRequestId, errors.single().errorClass)
    }

    @Test
    fun duplicateResponseAfterSuccessIsUnknownId() {
        val errors = CopyOnWriteArrayList<CodemError>()
        val writes = mutableListOf<String>()
        val peer = peer(writes, errors)
        val future = peer.request("thread/start")
        val id = JsonValue.parse(writes.single()).asObject().required("id")
        val frame = encodeJson(JsonValue.obj("jsonrpc" to JsonValue.Text("2.0"), "id" to id, "result" to JsonValue.obj("thread" to JsonValue.obj("id" to JsonValue.Text("thread-1")))))
        peer.consume(frame)
        assertEquals("thread-1", future.get().asObject().required("thread").asObject().required("id").asText())
        peer.consume(frame)
        assertEquals(CodemError.Class.UnknownRequestId, errors.single().errorClass)
    }

    @Test
    fun rejectsInvalidFrames() {
        for (line in listOf("{", """{"jsonrpc":"1.0","id":1,"result":{}}""", """{"jsonrpc":"2.0","result":{}}""", """{"jsonrpc":"2.0","method":"   ","params":{}}""")) {
            val errors = CopyOnWriteArrayList<CodemError>()
            peer(mutableListOf(), errors).consume(line)
            assertTrue(errors.isNotEmpty(), line)
        }
    }

    @Test
    fun closedPeerRejectsNewWrites() {
        val peer = peer(mutableListOf())
        peer.close()
        assertThrows(CodemError::class.java) { peer.notify("initialized") }
    }

    @Test
    fun concatenatesWhitespaceDeltasThroughTheTurnAccumulator() {
        val turns = com.codem.intellij.session.TurnAccumulator()
        turns.apply(RpcNotification("turn/started", JsonValue.obj("turn" to JsonValue.obj("id" to JsonValue.Text("turn-1")))), "thread-1")
        for (delta in listOf("FIRST LINE\n", "\n", "\tLAST LINE", "")) {
            turns.apply(RpcNotification("item/agentMessage/delta", JsonValue.obj("delta" to JsonValue.Text(delta))), "thread-1")
        }
        assertEquals("FIRST LINE\n\n\tLAST LINE", turns.current?.text.toString())
    }

    @Test
    fun rejectsMalformedJsonNumbersInsteadOfThrowingRawNumberFormat() {
        for (text in listOf("-", "1e", "1e+")) {
            try {
                JsonValue.parse(text)
                throw AssertionError("accepted $text")
            } catch (error: CodemError) {
                assertEquals(CodemError.Class.InvalidJson, error.errorClass, text)
            }
        }
        val peerErrors = CopyOnWriteArrayList<CodemError>()
        peer(mutableListOf(), peerErrors).consume("-")
        assertEquals(CodemError.Class.InvalidJson, peerErrors.single().errorClass)
    }

    private fun peer(writes: MutableList<String>, errors: MutableList<CodemError> = mutableListOf()) = RpcPeer(
        writeLine = writes::add,
        onNotification = {},
        onRequest = {},
        onProtocolError = { errors += it },
    )
}
