package com.codem.intellij.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.util.concurrent.TimeUnit

class FakeProcessTest {
    @Test
    fun handshakeThenRecycleOnClose() {
        val process = ScriptedProcess()
        val capabilities = handshakeCapabilities()
        val cwd = Files.createTempDirectory("codem-core-cwd")
        val runtime = fakeRuntime()
        val started = CoreProcess(
            runtime = runtime,
            workingDirectory = cwd,
            onNotification = {},
            onRequest = { request, peer -> peer.respondError(request.id, -32601, "Unsupported client request: ${request.method}") },
            onProtocolError = { throw it },
            processFactory = { _, _, _ -> process },
        )
        Thread {
            while (process.writes.isEmpty()) Thread.sleep(5)
            val request = JsonValue.parse(process.writes.peek()).asObject()
            process.enqueue(
                encodeJson(
                    JsonValue.obj(
                        "jsonrpc" to JsonValue.Text("2.0"),
                        "id" to request.required("id"),
                        "result" to capabilities,
                    ),
                ),
            )
        }.start()
        started.start()
        assertEquals(ResponseJsonrpc.Strict, started.responseJsonrpc)
        started.close().get(2, TimeUnit.SECONDS)
        assertTrue(!process.isAlive)
    }

    @Test
    fun crashDuringInitializeFailsStartAndKillsProcess() {
        val process = ScriptedProcess(crashAfterWrites = 1)
        val cwd = Files.createTempDirectory("codem-core-cwd")
        var error: Throwable? = null
        try {
            CoreProcess(
                runtime = fakeRuntime(),
                workingDirectory = cwd,
                timeouts = Timeouts(initializeMs = 800, rpcMs = 800, closeStageMs = 200),
                onNotification = {},
                onRequest = { _, _ -> },
                onProtocolError = {},
                processFactory = { _, _, _ -> process },
            ).start()
        } catch (thrown: Throwable) {
            error = thrown
        }
        assertTrue(error != null)
        assertTrue(!process.isAlive)
        val message = error!!.message ?: ""
        assertTrue(
            message.contains("closed") || message.contains("initialize") || message.contains("stdin") || message.contains("process"),
            message,
        )
    }

    @Test
    fun unexpectedCrashFailsSubsequentRequest() {
        val process = ScriptedProcess()
        val capabilities = handshakeCapabilities()
        val cwd = Files.createTempDirectory("codem-core-cwd")
        val started = CoreProcess(
            runtime = fakeRuntime(),
            workingDirectory = cwd,
            onNotification = {},
            onRequest = { _, _ -> },
            onProtocolError = {},
            processFactory = { _, _, _ -> process },
        )
        Thread {
            while (process.writes.isEmpty()) Thread.sleep(5)
            val request = JsonValue.parse(process.writes.peek()).asObject()
            process.enqueue(
                encodeJson(
                    JsonValue.obj(
                        "jsonrpc" to JsonValue.Text("2.0"),
                        "id" to request.required("id"),
                        "result" to capabilities,
                    ),
                ),
            )
        }.start()
        started.start()
        process.destroy(true)
        var failed = false
        try {
            started.request("thread/start", JsonValue.obj()).get(1, TimeUnit.SECONDS)
        } catch (_: Exception) {
            failed = true
        }
        assertTrue(failed)
        assertTrue(!process.isAlive)
    }

    /** 回调抛出非 CodeM 异常不能让 stdout 读线程静默死亡：待决请求被拒绝、上报协议失败并结束进程。 */
    @Test
    fun callbackExceptionFailsTheConnectionInsteadOfKillingTheReader() {
        val process = ScriptedProcess()
        val failures = java.util.concurrent.LinkedBlockingQueue<CodemError>()
        val started = CoreProcess(
            runtime = fakeRuntime(),
            workingDirectory = Files.createTempDirectory("codem-core-cwd"),
            onNotification = { throw IllegalStateException("fixture subscriber failed") },
            onRequest = { _, _ -> },
            onProtocolError = { failures.add(it) },
            processFactory = { _, _, _ -> process },
        )
        answerInitialize(process)
        started.start()
        val pending = started.request("thread/start", JsonValue.obj())
        process.enqueue(
            encodeJson(
                JsonValue.obj(
                    "jsonrpc" to JsonValue.Text("2.0"),
                    "method" to JsonValue.Text("warning"),
                    "params" to JsonValue.obj("message" to JsonValue.Text("fixture")),
                ),
            ),
        )
        val failure = failures.poll(2, TimeUnit.SECONDS) ?: throw AssertionError("reader failure was not reported")
        assertEquals(CodemError.Class.Protocol, failure.errorClass)
        assertTrue(failure.cause is IllegalStateException)
        org.junit.jupiter.api.Assertions.assertThrows(java.util.concurrent.ExecutionException::class.java) {
            pending.get(1, TimeUnit.SECONDS)
        }
        assertTrue(!process.isAlive)
    }

    private fun answerInitialize(process: ScriptedProcess) {
        val capabilities = handshakeCapabilities()
        Thread {
            while (process.writes.isEmpty()) Thread.sleep(5)
            val request = JsonValue.parse(process.writes.peek()).asObject()
            process.enqueue(
                encodeJson(
                    JsonValue.obj(
                        "jsonrpc" to JsonValue.Text("2.0"),
                        "id" to request.required("id"),
                        "result" to capabilities,
                    ),
                ),
            )
        }.start()
    }

    private fun fakeRuntime(): ResolvedRuntime {
        val file = Files.createTempFile("codem-core", "")
        Files.writeString(file, "x")
        val target = RuntimeLocator.targets.values.first()
        return ResolvedRuntime(target, RuntimeLocator.CORE_VERSION, RuntimeLocator.CLI_VERSION, file, file, file, file, "00")
    }

    private fun handshakeCapabilities(): JsonValue.ObjectValue {
        val handshake = java.nio.file.Path.of("../../packages/contracts/core/initializeHandshake.json")
            .let { if (Files.isRegularFile(it)) it else java.nio.file.Path.of("packages/contracts/core/initializeHandshake.json") }
        val sample = JsonValue.parse(Files.readString(handshake)).asObject()
        val events = sample.required("events") as JsonValue.ArrayValue
        val frame = events.items.first().asObject().required("frame").asObject()
        return frame.required("result").asObject()
    }
}
