package com.codem.intellij.core

import java.io.BufferedWriter
import java.io.InputStream
import java.nio.file.Path
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

data class ClientInfo(val name: String, val version: String) {
    init {
        require(name.isNotBlank() && version.isNotBlank()) { "CodeM App Server clientInfo name and version must be non-empty" }
    }
}

data class ProcessExit(val code: Int?, val signal: String?, val expected: Boolean)

/**
 * 使用参数数组启动 Core，不拼接 shell。stdout 只读协议，stderr 持续排空并有界记录。
 * 关闭顺序：有界中断 → 关 stdin → 正常终止 → 强制终止。重复 close 等待同一结果。
 */
class CoreProcess(
    val runtime: ResolvedRuntime,
    val workingDirectory: Path,
    val clientInfo: ClientInfo = ClientInfo("codem-intellij", "0.1.0"),
    val extraArguments: List<String> = emptyList(),
    val extraEnvironment: Map<String, String> = emptyMap(),
    val timeouts: Timeouts = Timeouts(),
    val onNotification: (RpcNotification) -> Unit,
    val onRequest: (RpcRequest, RpcPeer) -> Unit,
    val onProtocolError: (CodemError) -> Unit,
    val onStderr: (String) -> Unit = {},
    val onExit: (ProcessExit) -> Unit = {},
    private val processFactory: (List<String>, Path, Map<String, String>) -> ProcessHandleAdapter = ::defaultProcess,
) {
    lateinit var peer: RpcPeer
        private set
    lateinit var initialization: ProtocolCapabilities.Initialization
        private set
    var responseJsonrpc: ResponseJsonrpc? = null
        private set
    private lateinit var process: ProcessHandleAdapter
    private val expectedClose = AtomicBoolean(false)
    private val closeFuture = AtomicReference<CompletableFuture<Void>?>(null)
    private val stderrBytes = AtomicReference("")
    private val generation = System.nanoTime()
    private val frames = FrameReader()

    val connectionGeneration: Long get() = generation

    fun start(): CoreProcess {
        require(workingDirectory.isAbsolute) { "CodeM App Server workingDirectory must be absolute" }
        val command = buildList {
            add(runtime.coreExecutable.toString())
            addAll(extraArguments)
            add("app-server")
        }
        process = processFactory(command, workingDirectory, extraEnvironment)
        peer = RpcPeer(
            writeLine = { line -> process.writeLine(line) },
            onNotification = onNotification,
            onRequest = { request -> onRequest(request, peer) },
            onProtocolError = { error ->
                onProtocolError(error)
                if (process.isAlive) process.destroy(false)
            },
        )
        process.startStdout { bytes, length ->
            try {
                frames.push(bytes, length).forEach(peer::consume)
            } catch (error: CodemError) {
                peer.close()
                onProtocolError(error)
                if (process.isAlive) process.destroy(false)
            }
        }
        process.startStderr { text ->
            val next = (stderrBytes.get() + text).takeLast(8 * 1024)
            stderrBytes.set(next)
            onStderr(text)
        }
        process.onExit { code, signal ->
            if (!expectedClose.get()) peer.failUnexpectedStdoutClose()
            onExit(ProcessExit(code, signal, expectedClose.get()))
        }
        val initialize = peer.requestAbandonable(
            "initialize",
            JsonValue.obj(
                "clientInfo" to JsonValue.obj(
                    "name" to JsonValue.Text(clientInfo.name),
                    "version" to JsonValue.Text(clientInfo.version),
                ),
            ),
        )
        try {
            val result = initialize.response.get(timeouts.initializeMs, TimeUnit.MILLISECONDS)
            initialization = ProtocolCapabilities.validateInitialize(result, runtime.coreVersion)
            responseJsonrpc = peer.responseJsonrpc ?: throw CodemError.Protocol(CodemError.Class.InvalidFrame, "CodeM App Server initialize response shape was not recorded")
            peer.notify("initialized")
            return this
        } catch (error: Throwable) {
            expectedClose.set(true)
            initialize.abandon()
            close().join()
            throw when (error) {
                is java.util.concurrent.TimeoutException -> {
                    initialize.abandon()
                    CodemError.Protocol(CodemError.Class.Protocol, "CodeM App Server initialize timed out after ${timeouts.initializeMs}ms")
                }
                is CodemError -> error
                else -> CodemError.Process("CodeM App Server initialize failed", error, "initialize")
            }
        }
    }

    fun request(method: String, params: JsonValue.ObjectValue = JsonValue.ObjectValue(emptyMap())): CompletableFuture<JsonValue> =
        peer.request(method, params)

    fun close(): CompletableFuture<Void> {
        val existing = closeFuture.get()
        if (existing != null) return existing
        val created = CompletableFuture<Void>()
        if (!closeFuture.compareAndSet(null, created)) return closeFuture.get()!!
        expectedClose.set(true)
        Thread {
            try {
                peer.close()
                process.shutdown(timeouts.closeStageMs)
                created.complete(null)
            } catch (error: Throwable) {
                created.completeExceptionally(error)
            }
        }.apply { isDaemon = true; name = "codem-core-close" }.start()
        return created
    }
}

interface ProcessHandleAdapter {
    val isAlive: Boolean
    val pid: Long
    fun writeLine(line: String)
    fun startStdout(consumer: (ByteArray, Int) -> Unit)
    fun startStderr(consumer: (String) -> Unit)
    fun onExit(listener: (Int?, String?) -> Unit)
    fun destroy(force: Boolean)
    fun shutdown(stageMs: Long)
}

class JavaProcessAdapter(private val process: Process) : ProcessHandleAdapter {
    private val stdin: BufferedWriter = process.outputStream.bufferedWriter()
    override val isAlive: Boolean get() = process.isAlive
    override val pid: Long get() = process.pid()

    override fun writeLine(line: String) {
        synchronized(stdin) {
            stdin.write(line)
            stdin.write("\n")
            stdin.flush()
        }
    }

    override fun startStdout(consumer: (ByteArray, Int) -> Unit) = pump(process.inputStream) { consumer(it, it.size) }

    override fun startStderr(consumer: (String) -> Unit) {
        Thread {
            val buffer = ByteArray(4096)
            while (true) {
                val read = process.errorStream.read(buffer)
                if (read < 0) break
                consumer(String(buffer, 0, read, Charsets.UTF_8))
            }
        }.apply { isDaemon = true; name = "codem-core-stderr" }.start()
    }

    override fun onExit(listener: (Int?, String?) -> Unit) {
        process.onExit().thenAccept { completed ->
            listener(completed.exitValue(), null)
        }
    }

    override fun destroy(force: Boolean) {
        if (force) process.destroyForcibly() else process.destroy()
    }

    override fun shutdown(stageMs: Long) {
        try {
            stdin.close()
        } catch (_: Exception) {
        }
        if (process.waitFor(stageMs, TimeUnit.MILLISECONDS)) return
        process.destroy()
        if (process.waitFor(stageMs, TimeUnit.MILLISECONDS)) return
        process.destroyForcibly()
        if (!process.waitFor(stageMs, TimeUnit.MILLISECONDS)) {
            throw CodemError.Process("CodeM App Server did not exit after stdin close, SIGTERM, and SIGKILL", stage = "close")
        }
    }

    private fun pump(stream: InputStream, consumer: (ByteArray) -> Unit) {
        Thread {
            val buffer = ByteArray(8192)
            while (true) {
                val read = stream.read(buffer)
                if (read < 0) break
                consumer(buffer.copyOf(read))
            }
        }.apply { isDaemon = true; name = "codem-core-stdout" }.start()
    }
}

fun defaultProcess(command: List<String>, cwd: Path, environment: Map<String, String>): ProcessHandleAdapter {
    val builder = ProcessBuilder(command)
        .directory(cwd.toFile())
        .redirectErrorStream(false)
    builder.environment().putAll(environment)
    return JavaProcessAdapter(builder.start())
}

/** 测试用假进程：按脚本回放帧，并记录写入。 */
class ScriptedProcess(
    private val stdoutFrames: ConcurrentLinkedQueue<String> = ConcurrentLinkedQueue(),
    private val crashAfterWrites: Int? = null,
) : ProcessHandleAdapter {
    val writes = ConcurrentLinkedQueue<String>()
    private val alive = AtomicBoolean(true)
    private var stdout: ((ByteArray, Int) -> Unit)? = null
    private var exit: ((Int?, String?) -> Unit)? = null
    override val isAlive: Boolean get() = alive.get()
    override val pid: Long = 4242

    override fun writeLine(line: String) {
        if (!alive.get()) throw CodemError.Protocol(CodemError.Class.StdinNotWritable, "CodeM App Server stdin is not writable")
        writes.add(line)
        if (crashAfterWrites != null && writes.size >= crashAfterWrites) {
            destroy(true)
        }
    }

    override fun startStdout(consumer: (ByteArray, Int) -> Unit) {
        stdout = consumer
        Thread {
            while (alive.get()) {
                val frame = stdoutFrames.poll()
                if (frame != null) {
                    val bytes = (frame + "\n").toByteArray()
                    consumer(bytes, bytes.size)
                } else {
                    Thread.sleep(5)
                }
            }
        }.apply { isDaemon = true }.start()
    }

    override fun startStderr(consumer: (String) -> Unit) = Unit
    override fun onExit(listener: (Int?, String?) -> Unit) { exit = listener }
    override fun destroy(force: Boolean) {
        if (alive.compareAndSet(true, false)) exit?.invoke(if (force) 137 else 0, if (force) "SIGKILL" else null)
    }
    override fun shutdown(stageMs: Long) { destroy(false) }

    fun enqueue(frame: String) { stdoutFrames.add(frame) }
}
