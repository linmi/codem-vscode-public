package com.codem.intellij.core

import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
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
 * 关闭后拒绝 pending；未知 id / 重复响应 / 非法结构 / 回调异常走协议失败。
 * onProtocolError 在 pending 已被拒绝后调用，自身不得抛出。
 */
class RpcPeer(
    private val writeLine: (String) -> Unit,
    private val onNotification: (RpcNotification) -> Unit,
    private val onRequest: (RpcRequest) -> Unit,
    private val onProtocolError: (CodemError) -> Unit,
    private val abandonedLimit: Int = 32,
    private val abandonedTtlMs: Long = 30_000,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
    sweeper: ScheduledExecutorService = sharedSweeper,
) {
    private val nextId = AtomicInteger(1)
    private val pending = ConcurrentHashMap<String, Pending>()
    private val abandoned = AbandonedRequests(abandonedLimit, abandonedTtlMs, nowMs, sweeper, ::failProtocol)
    private val closed = AtomicBoolean(false)
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
            if (pending.remove(key) != null) abandoned.add(key, method)
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
            // 与 Node 读循环一致：回调异常转为协议失败并拒绝 pending，不能带走读取线程。
            try {
                if (id != null) {
                    onRequest(RpcRequest(RpcId.parse(id), method.value, params))
                } else {
                    onNotification(RpcNotification(method.value, params))
                }
            } catch (error: Exception) {
                val kind = if (id != null) "request" else "notification"
                failProtocol(error as? CodemError ?: CodemError.Protocol(CodemError.Class.Protocol, "CodeM App Server $kind callback failed", error))
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
            if (closed.get() || abandoned.consume(key)) return
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
                CodemError.RequestRejected(current.method, "CodeM App Server ${current.method} failed (${(error.fields["code"] as JsonValue.NumberValue).literal}): ${(error.fields["message"] as JsonValue.Text).value}"),
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
        abandoned.close()
        rejectPending(CodemError.Protocol(CodemError.Class.ConnectionClosed, "CodeM App Server connection closed"))
    }

    fun failUnexpectedStdoutClose() {
        if (!closed.compareAndSet(false, true)) return
        abandoned.close()
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

    /** 清扫线程可能与 close 并发；已关闭的连接不再报告协议失败。 */
    private fun failProtocol(error: CodemError) {
        if (!closed.compareAndSet(false, true)) return
        abandoned.close()
        rejectPending(error)
        onProtocolError(error)
    }

    private data class Pending(val method: String, val future: CompletableFuture<JsonValue>)

    private companion object {
        /** 所有连接共用一个守护线程；队列清空后线程超时退出，不常驻插件线程。 */
        val sharedSweeper: ScheduledExecutorService = ScheduledThreadPoolExecutor(1) { task ->
            Thread(task, "codem-rpc-abandoned-sweep").apply { isDaemon = true }
        }.apply {
            removeOnCancelPolicy = true
            setKeepAliveTime(1, TimeUnit.SECONDS)
            allowCoreThreadTimeOut(true)
        }
    }
}

/**
 * 对照 Node rpcAbandoned.ts：按最早到期时间排一个清扫定时器，Core 不再发帧也会到期。
 * 只由 RpcPeer 持有；close 取消定时器，之后不再接收新条目。
 */
private class AbandonedRequests(
    private val limit: Int,
    private val ttlMs: Long,
    private val nowMs: () -> Long,
    private val sweeper: ScheduledExecutorService,
    private val failProtocol: (CodemError) -> Unit,
) {
    private val expiries = HashMap<String, Long>()
    private var timer: ScheduledFuture<*>? = null
    private var closed = false

    fun add(key: String, method: String) {
        val full = synchronized(this) {
            if (closed) return
            if (expiries.size >= limit) return@synchronized true
            expiries[key] = nowMs() + ttlMs
            scheduleLocked()
            false
        }
        if (full) failProtocol(CodemError.Protocol(CodemError.Class.Protocol, "CodeM App Server exceeded $limit unacknowledged requests while abandoning $method"))
    }

    fun consume(key: String): Boolean = synchronized(this) {
        if (expiries.remove(key) == null) return false
        scheduleLocked()
        true
    }

    fun close() = synchronized(this) {
        closed = true
        timer?.cancel(false)
        timer = null
        expiries.clear()
    }

    private fun scheduleLocked() {
        timer?.cancel(false)
        timer = null
        val next = expiries.values.minOrNull() ?: return
        timer = sweeper.schedule(Runnable { sweep() }, maxOf(0L, next - nowMs()), TimeUnit.MILLISECONDS)
    }

    private fun sweep() {
        val expired = synchronized(this) {
            if (closed) return
            val now = nowMs()
            val key = expiries.entries.firstOrNull { it.value <= now }?.key
            if (key == null) scheduleLocked()
            key
        } ?: return
        failProtocol(CodemError.Protocol(CodemError.Class.Protocol, "CodeM App Server did not acknowledge abandoned request $expired within ${ttlMs}ms"))
    }
}
