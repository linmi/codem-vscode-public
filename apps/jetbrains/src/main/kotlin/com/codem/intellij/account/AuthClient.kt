package com.codem.intellij.account

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue
import com.codem.intellij.core.ResolvedRuntime
import com.codem.intellij.core.Timeouts
import java.io.OutputStream
import java.nio.file.Path
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

data class AuthStatus(
    val loggedIn: Boolean,
    val authMethod: String?,
    val routerCredential: Boolean?,
    val serverUrl: String?,
    val tenantId: String?,
    val userId: String?,
    val displayName: String?,
)

enum class LoginProgress { AuthorizationReady, Binding, Authenticated }

/**
 * 只调用锁定 CLI：`auth status --json`、`auth login --json --force`。
 * 不读写凭据文件。浏览器取消/失败可恢复。无项目也可登录。
 */
class AuthClient(
    private val runtime: ResolvedRuntime,
    private val workingDirectory: Path,
    private val environment: Map<String, String> = emptyMap(),
    private val timeouts: Timeouts = Timeouts(),
    private val runner: AuthProcessRunner = JavaAuthProcessRunner(),
) : AuthGateway {
    override fun status(): AuthStatus {
        require(workingDirectory.isAbsolute) { "CodeM authentication workingDirectory must be absolute" }
        val result = runner.run(runtime.authExecutable, listOf("auth", "status", "--json"), workingDirectory, environment, timeouts.authStatusMs, 64 * 1024)
        val status = parseStatus(result.stdout)
        if (status?.loggedIn == false && result.signal == null && (result.exitCode == 0 || result.exitCode == 1)) return status
        if (result.exitCode != 0 || result.signal != null) {
            throw CodemError.Authentication("CodeM authentication status failed (exit=${result.exitCode}, signal=${result.signal})")
        }
        return status ?: throw CodemError.Authentication("CodeM authentication status returned invalid JSON")
    }

    override fun assertAuthenticated(status: AuthStatus) {
        if (!status.loggedIn) throw CodemError.Authentication("CodeM login is required before starting App Server threads")
        if (status.routerCredential != true) throw CodemError.Authentication("CodeM login cannot route tasks; sign out and sign in again")
    }

    fun startLogin(presentAuthorization: (String) -> Unit, onProgress: (LoginProgress) -> Unit = {}): LoginOperation {
        return LoginOperation(runtime, workingDirectory, environment, timeouts, runner, presentAuthorization, onProgress)
    }
}

class LoginOperation(
    runtime: ResolvedRuntime,
    workingDirectory: Path,
    environment: Map<String, String>,
    private val timeouts: Timeouts,
    runner: AuthProcessRunner,
    presentAuthorization: (String) -> Unit,
    onProgress: (LoginProgress) -> Unit,
) {
    private val cancelled = AtomicBoolean(false)
    private val process = runner.start(runtime.authExecutable, listOf("auth", "login", "--json", "--force"), workingDirectory, environment)
    // stdout 读取线程写入，awaitSuccess 在调用线程读取。
    @Volatile private var lastEvent: String? = null
    @Volatile private var presented = false
    @Volatile var error: CodemError? = null
        private set

    init {
        process.onStdoutLine { line ->
            if (cancelled.get() || error != null) return@onStdoutLine
            val event = parseLoginEvent(line) ?: run {
                fail(CodemError.Authentication("CodeM login emitted an invalid JSON event"))
                return@onStdoutLine
            }
            lastEvent = event.type
            when (event.type) {
                "login_session" -> {
                    if (presented) {
                        fail(CodemError.Authentication("CodeM login emitted more than one authorization session"))
                        return@onStdoutLine
                    }
                    val url = event.authorizationUrl ?: run {
                        fail(CodemError.Authentication("CodeM login did not provide an authorization URL"))
                        return@onStdoutLine
                    }
                    if (!url.startsWith("https://") || url.contains('@')) {
                        fail(CodemError.Authentication("CodeM authorization URL must be an HTTPS URL without embedded credentials"))
                        return@onStdoutLine
                    }
                    presented = true
                    if (!callback("progress") { onProgress(LoginProgress.AuthorizationReady) }) return@onStdoutLine
                    callback("authorization presenter") { presentAuthorization(url) }
                }
                "login_binding" -> callback("progress") { onProgress(LoginProgress.Binding) }
                "login_success" -> callback("progress") { onProgress(LoginProgress.Authenticated) }
                "login_error" -> fail(CodemError.Authentication(event.message ?: event.code ?: "CodeM login failed"))
            }
        }
    }

    /**
     * 对照 TS reportProgress/presentAuthorization：宿主回调抛出只让本次登录失败并回收子进程，
     * 不能带走 stdout 读取线程，否则 CLI 继续等授权，awaitSuccess 要到 authLoginMs 才返回。
     */
    private fun callback(label: String, action: () -> Unit): Boolean = try {
        action()
        true
    } catch (thrown: Exception) {
        fail(thrown as? CodemError ?: CodemError.Authentication("CodeM login $label failed", thrown))
        false
    }

    fun cancel() {
        if (!cancelled.compareAndSet(false, true)) return
        process.destroy()
    }

    fun awaitSuccess() {
        val exit = process.await(timeouts.authLoginMs)
        if (cancelled.get()) throw CodemError.Cancelled("CodeM login was cancelled")
        error?.let { throw it }
        if (exit.exitCode != 0 || exit.signal != null) throw CodemError.Authentication("CodeM login failed (exit=${exit.exitCode})")
        if (lastEvent != "login_success" || !presented) throw CodemError.Authentication("CodeM login ended without a successful authorization flow")
    }

    private fun fail(value: CodemError) {
        if (error != null || cancelled.get()) return
        error = value
        process.destroy()
    }
}

data class AuthCommandResult(val exitCode: Int?, val signal: String?, val stdout: String)
data class LoginEvent(val type: String, val authorizationUrl: String?, val code: String?, val message: String?)

interface AuthProcessRunner {
    fun run(executable: Path, arguments: List<String>, cwd: Path, environment: Map<String, String>, timeoutMs: Long, stdoutLimit: Int): AuthCommandResult
    fun start(executable: Path, arguments: List<String>, cwd: Path, environment: Map<String, String>): LiveAuthProcess
}

interface LiveAuthProcess {
    fun onStdoutLine(listener: (String) -> Unit)

    /**
     * 对照 Node 的 close：进程退出且 stdout 读到 EOF、末行也已交给监听器后才返回；整段等待受 timeoutMs 硬截止，
     * 截止后不再交付 stdout 行。登录进行中 stdout 读取失败时结束进程并抛出 Authentication 错误。
     */
    fun await(timeoutMs: Long): AuthCommandResult

    /** 结束进程；之后读取线程安静结束，不再交付 stdout 行。 */
    fun destroy()
}

class JavaAuthProcessRunner : AuthProcessRunner {
    /**
     * 调用方用 Future 硬截止。waitFor 或 readNBytes 挂死时也必须在 timeoutMs 内返回，
     * 并关掉流、杀掉子进程，避免 Host 线程池被 auth status 占满。
     */
    override fun run(executable: Path, arguments: List<String>, cwd: Path, environment: Map<String, String>, timeoutMs: Long, stdoutLimit: Int): AuthCommandResult {
        val builder = ProcessBuilder(buildList { add(executable.toString()); addAll(arguments) }).directory(cwd.toFile())
        builder.environment().putAll(environment)
        val process = try {
            builder.start()
        } catch (error: Exception) {
            throw CodemError.Authentication("CodeM authentication status failed to start", error)
        }
        try {
            process.outputStream.close()
        } catch (_: Exception) {
        }
        val result = CompletableFuture<AuthCommandResult>()
        val stdoutReader = Thread({
            try {
                val stdout = process.inputStream.readNBytes(stdoutLimit + 1)
                if (stdout.size > stdoutLimit) {
                    result.completeExceptionally(
                        CodemError.Authentication("CodeM authentication status stdout exceeded $stdoutLimit bytes"),
                    )
                    return@Thread
                }
                if (!process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)) {
                    result.completeExceptionally(
                        CodemError.Authentication("CodeM authentication status timed out after ${timeoutMs}ms"),
                    )
                    return@Thread
                }
                result.complete(AuthCommandResult(process.exitValue(), null, stdout.toString(Charsets.UTF_8)))
            } catch (error: Throwable) {
                result.completeExceptionally(error)
            }
        }, "codem-auth-stdout").apply {
            isDaemon = true
            start()
        }
        Thread({
            try {
                process.errorStream.copyTo(OutputStream.nullOutputStream())
            } catch (_: Exception) {
            }
        }, "codem-auth-stderr").apply {
            isDaemon = true
            start()
        }
        try {
            return result.get(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (error: TimeoutException) {
            throw CodemError.Authentication("CodeM authentication status timed out after ${timeoutMs}ms")
        } catch (error: ExecutionException) {
            val cause = error.cause
            if (cause is CodemError) throw cause
            throw CodemError.Authentication("CodeM authentication status failed", cause ?: error)
        } finally {
            if (process.isAlive) process.destroyForcibly()
            try {
                process.inputStream.close()
            } catch (_: Exception) {
            }
            try {
                process.errorStream.close()
            } catch (_: Exception) {
            }
            stdoutReader.join(500)
        }
    }

    override fun start(executable: Path, arguments: List<String>, cwd: Path, environment: Map<String, String>): LiveAuthProcess {
        val builder = ProcessBuilder(buildList { add(executable.toString()); addAll(arguments) }).directory(cwd.toFile())
        builder.environment().putAll(environment)
        val process = builder.start()
        process.outputStream.close()
        Thread { process.errorStream.use { it.readAllBytes() } }.apply {
            isDaemon = true
            name = "codem-login-stderr"
            start()
        }
        val stdoutClosed = CompletableFuture<Unit>()
        // 由我们停止：destroy（Unix 上 JDK 的 destroy 会关闭进程 stdout）或 await 截止。此后读取线程安静结束，不再交付行。
        val stopped = AtomicBoolean(false)
        return object : LiveAuthProcess {
            override fun onStdoutLine(listener: (String) -> Unit) {
                Thread {
                    try {
                        // readLine 在 EOF 时交出没有换行结尾的末行。
                        process.inputStream.bufferedReader().use { reader ->
                            while (true) {
                                val line = reader.readLine() ?: break
                                // 登录已失败、取消或超时：缓冲里迟到的 login_success 不能再推进度。
                                if (stopped.get()) break
                                listener(line)
                            }
                        }
                    } catch (error: Exception) {
                        // 我们关闭 stdout 引起的 IOException 是预期结束；登录仍在进行时的读取失败
                        // 交给 await 报告并结束 CLI，不带着异常退出线程，也不空等截止。
                        if (!stopped.get()) {
                            stdoutClosed.completeExceptionally(error)
                            destroy()
                        }
                    } finally {
                        stdoutClosed.complete(Unit)
                    }
                }.apply { isDaemon = true; name = "codem-login-stdout" }.start()
            }

            override fun await(timeoutMs: Long): AuthCommandResult {
                val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
                try {
                    if (!process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)) throw TimeoutException()
                    // 退出早于读取线程处理完末行；不等 EOF 会把刚写出的 login_success 判成失败。
                    stdoutClosed.get(maxOf(0L, deadline - System.nanoTime()), TimeUnit.NANOSECONDS)
                } catch (_: TimeoutException) {
                    stopped.set(true)
                    process.destroyForcibly()
                    try {
                        process.inputStream.close()
                    } catch (_: Exception) {
                    }
                    throw CodemError.Authentication("CodeM login timed out after ${timeoutMs}ms")
                } catch (error: ExecutionException) {
                    throw CodemError.Authentication("CodeM login stdout reader failed", error.cause ?: error)
                }
                return AuthCommandResult(process.exitValue(), null, "")
            }

            override fun destroy() {
                stopped.set(true)
                process.destroy()
                if (!process.waitFor(2_000, TimeUnit.MILLISECONDS)) process.destroyForcibly()
            }
        }
    }
}

/** Like authentication.ts parseAuthStatus: a present optional field of the wrong type makes the whole status invalid. */
fun parseStatus(text: String): AuthStatus? {
    val obj = cliJsonObject(text) ?: return null
    val loggedIn = obj.booleanOrNull("loggedIn") ?: return null
    return try {
        AuthStatus(
            loggedIn = loggedIn,
            authMethod = obj.optionalString("authMethod", AUTH_STATUS),
            routerCredential = obj.optionalBoolean("routerCredential", AUTH_STATUS),
            serverUrl = obj.optionalString("serverUrl", AUTH_STATUS),
            tenantId = obj.optionalString("tenantId", AUTH_STATUS),
            userId = obj.optionalString("userId", AUTH_STATUS),
            displayName = obj.optionalString("displayName", AUTH_STATUS),
        )
    } catch (_: CodemError) {
        null
    }
}

private const val AUTH_STATUS = "auth status"

fun parseLoginEvent(line: String): LoginEvent? {
    val obj = cliJsonObject(line) ?: return null
    val type = obj.stringOrNull("type")?.takeIf { it.isNotBlank() } ?: return null
    return LoginEvent(type, obj.stringOrNull("authorizationUrl"), obj.stringOrNull("code"), obj.stringOrNull("message"))
}

/** CLI output that is not a JSON object is not a status or event; the caller reports it, this returns null. */
private fun cliJsonObject(text: String): JsonValue.ObjectValue? = try {
    JsonValue.parse(text.trim()).asObject()
} catch (_: CodemError) {
    null
}
