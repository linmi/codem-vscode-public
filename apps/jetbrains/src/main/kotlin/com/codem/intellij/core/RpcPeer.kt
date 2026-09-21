package com.codem.intellij.core

import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

data class RpcNotification(val method: String, val params: JsonValue.ObjectValue)
data class RpcRequest(val id: RpcId, val method: String, val params: JsonValue.ObjectValue)

sealed class RpcId {
    data class NumberId(val value: Long) : RpcId() {
        override fun toString(): String = value.toString()
    }
    data class TextId(val value: String) : RpcId() {
        override fun toString(): String = value
    }

    companion object {
        fun parse(value: JsonValue): RpcId = when (value) {
            is JsonValue.Text -> TextId(value.value)
            is JsonValue.NumberValue -> {
                if (value.value != value.value.toLong().toDouble()) {
                    throw CodemError.Protocol(CodemError.Class.InvalidFrame, "RPC id must be an integer or string")
                }
                NumberId(value.value.toLong())
            }
            else -> throw CodemError.Protocol(CodemError.Class.InvalidFrame, "RPC id must be an integer or string")
        }
    }
}

enum class ResponseJsonrpc { Strict, Omitted }

data class AbandonableRequest(
    val response: CompletableFuture<JsonValue>,
    val abandon: () -> Unit,
)

/**
 * 唯一写入所有者。请求、响应、通知和废弃请求分别处理。
 * 关闭后拒绝 pending；未知 id / 重复响应 / 非法结构走协议失败。
 */
class RpcPeer(
    private val writeLine: (String) -> Unit,
    private val onNotification: (RpcNotification) -> Unit,
    private val onRequest: (RpcRequest) -> Unit,
    private val onProtocolError: (CodemError) -> Unit,
    private val abandonedLimit: Int = 32,
    private val abandonedTtlMs: Long = 30_000,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
) {
    private val nextId = AtomicInteger(1)
    private val pending = ConcurrentHashMap<String, Pending>()
    private val abandoned = ConcurrentHashMap<String, Long>()
    private val closed = AtomicBoolean(false)
    private val protocolFailed = AtomicBoolean(false)
    var responseJsonrpc: ResponseJsonrpc? = null
        private set

    fun request(method: String, params: JsonValue.ObjectValue = JsonValue.ObjectValue(emptyMap())): CompletableFuture<JsonValue> =
        requestAbandonable(method, params).response

    fun requestAbandonable(method: String, params: JsonValue.ObjectValue = JsonValue.ObjectValue(emptyMap())): AbandonableRequest {
        val id = nextId.getAndIncrement().toLong()
        val key = id.toString()
        val future = CompletableFuture<JsonValue>()
        pending[key] = Pending(method, future)
        try {
            write(JsonValue.obj("id" to JsonValue.NumberValue(id.toDouble(), id.toString()), "method" to JsonValue.Text(method), "params" to params))
        } catch (error: Throwable) {
            pending.remove(key)
            throw error
        }
        return AbandonableRequest(future) {
            if (pending.remove(key) != null) {
                if (abandoned.size >= abandonedLimit) {
                    failProtocol(CodemError.Protocol(CodemError.Class.Protocol, "CodeM App Server exceeded $abandonedLimit unacknowledged requests while abandoning $method"))
                    return@AbandonableRequest
                }
                abandoned[key] = nowMs() + abandonedTtlMs
            }
        }
    }

    fun notify(method: String, params: JsonValue.ObjectValue = JsonValue.ObjectValue(emptyMap())) {
        write(JsonValue.obj("method" to JsonValue.Text(method), "params" to params))
    }

    fun respond(id: RpcId, result: JsonValue) {
        write(JsonValue.obj("id" to encodeId(id), "result" to result))
    }

    fun respondError(id: RpcId, code: Int, message: String, data: JsonValue? = null) {
        val error = linkedMapOf("code" to JsonValue.NumberValue(code.toDouble(), code.toString()), "message" to JsonValue.Text(message))
        if (data != null) error["data"] = data
        write(JsonValue.obj("id" to encodeId(id), "error" to JsonValue.ObjectValue(error)))
    }

    fun consume(line: String) {
        if (closed.get()) return
        expireAbandoned()
        val value = try {
            JsonValue.parse(line)
        } catch (error: CodemError) {
            failProtocol(CodemError.Protocol(CodemError.Class.InvalidJson, "CodeM App Server stdout contained invalid JSON", error))
            return
        }
        val obj = try {
            value.asObject()
        } catch (error: CodemError) {
            failProtocol(error)
            return
        }
        val jsonrpc = obj.fields["jsonrpc"]
        if (jsonrpc != null && (jsonrpc !is JsonValue.Text || jsonrpc.value != "2.0")) {
            failProtocol(CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM App Server emitted an invalid RPC frame"))
            return
        }
        val observed = if (jsonrpc is JsonValue.Text) ResponseJsonrpc.Strict else ResponseJsonrpc.Omitted
        val method = obj.fields["method"]
        if (method != null) {
            if (method !is JsonValue.Text || method.value.isBlank()) {
                failProtocol(CodemError.Protocol(CodemError.Class.InvalidMethodFrame, "CodeM App Server emitted an invalid method frame"))
                return
            }
            val params = obj.fields["params"] ?: JsonValue.ObjectValue(emptyMap())
            if (params !is JsonValue.ObjectValue) {
                failProtocol(CodemError.Protocol(CodemError.Class.InvalidMethodFrame, "CodeM App Server emitted an invalid method frame"))
                return
            }
            val id = obj.fields["id"]
            if (id != null) {
                try {
                    onRequest(RpcRequest(RpcId.parse(id), method.value, params))
                } catch (error: CodemError) {
                    failProtocol(error)
                }
            } else {
                onNotification(RpcNotification(method.value, params))
            }
            return
        }
        val id = obj.fields["id"] ?: run {
            failProtocol(CodemError.Protocol(CodemError.Class.UncorrelatedResponse, "CodeM App Server emitted an uncorrelated response"))
            return
        }
        val rpcId = try {
            RpcId.parse(id)
        } catch (error: CodemError) {
            failProtocol(CodemError.Protocol(CodemError.Class.UncorrelatedResponse, "CodeM App Server emitted an uncorrelated response", error))
            return
        }
        responseJsonrpc = observed
        val key = rpcId.toString()
        val current = pending.remove(key)
        if (current == null) {
            if (closed.get() || abandoned.remove(key) != null) return
            failProtocol(CodemError.Protocol(CodemError.Class.UnknownRequestId, "CodeM App Server responded to unknown request $key"))
            return
        }
        val error = obj.fields["error"]
        if (error != null) {
            if (error !is JsonValue.ObjectValue || error.fields["code"] !is JsonValue.NumberValue || error.fields["message"] !is JsonValue.Text) {
                val failure = CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM App Server emitted an invalid error")
                current.future.completeExceptionally(failure)
                failProtocol(failure)
                return
            }
            current.future.completeExceptionally(
                CodemError.Protocol(CodemError.Class.Protocol, "CodeM App Server ${current.method} failed (${(error.fields["code"] as JsonValue.NumberValue).literal}): ${(error.fields["message"] as JsonValue.Text).value}"),
            )
            return
        }
        val result = obj.fields["result"] ?: run {
            val failure = CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM App Server ${current.method} omitted its result")
            current.future.completeExceptionally(failure)
            failProtocol(failure)
            return
        }
        current.future.complete(result)
    }

    fun close() {
        if (!closed.compareAndSet(false, true)) return
        abandoned.clear()
        rejectPending(CodemError.Protocol(CodemError.Class.ConnectionClosed, "CodeM App Server connection closed"))
    }

    fun failUnexpectedStdoutClose() {
        if (!closed.compareAndSet(false, true)) return
        rejectPending(CodemError.Protocol(CodemError.Class.ConnectionClosed, "CodeM App Server closed stdout unexpectedly"))
    }

    val pendingCount: Int get() = pending.size

    private fun write(value: JsonValue.ObjectValue) {
        if (closed.get()) throw CodemError.Protocol(CodemError.Class.StdinNotWritable, "CodeM App Server stdin is not writable")
        val fields = linkedMapOf<String, JsonValue>("jsonrpc" to JsonValue.Text("2.0"))
        fields.putAll(value.fields)
        writeLine(encodeJson(JsonValue.ObjectValue(fields)))
    }

    private fun encodeId(id: RpcId): JsonValue = when (id) {
        is RpcId.NumberId -> JsonValue.NumberValue(id.value.toDouble(), id.value.toString())
        is RpcId.TextId -> JsonValue.Text(id.value)
    }

    private fun rejectPending(error: CodemError) {
        val values = pending.values.toList()
        pending.clear()
        values.forEach { it.future.completeExceptionally(error) }
    }

    private fun failProtocol(error: CodemError) {
        if (!protocolFailed.compareAndSet(false, true)) return
        closed.set(true)
        abandoned.clear()
        rejectPending(error)
        onProtocolError(error)
    }

    private fun expireAbandoned() {
        val now = nowMs()
        val expired = abandoned.entries.firstOrNull { it.value <= now } ?: return
        failProtocol(CodemError.Protocol(CodemError.Class.Protocol, "CodeM App Server did not acknowledge abandoned request ${expired.key} within ${abandonedTtlMs}ms"))
    }

    private data class Pending(val method: String, val future: CompletableFuture<JsonValue>)
}
