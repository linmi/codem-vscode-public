package com.codem.intellij.ide

import java.io.IOException

/**
 * The OS inhibitor for one platform, or null where none is supported. Each one ends by itself when the IDE process
 * [hostPid] exits, so a crashed IDE can never leave the machine unable to sleep. Same commands as VS Code keepAwake.ts.
 */
object Inhibitors {
    fun command(osName: String, hostPid: Long): List<String>? {
        val os = osName.lowercase()
        val pid = hostPid.toString()
        return when {
            // -i blocks idle sleep only; the display may still turn off. -w exits with the IDE.
            os.startsWith("mac") -> listOf("caffeinate", "-i", "-w", pid)
            os.startsWith("linux") -> listOf(
                "systemd-inhibit", "--what=idle:sleep", "--who=CodeM", "--why=CodeM 防休眠已开启", "--mode=block",
                "tail", "--pid=$pid", "-f", "/dev/null",
            )
            os.startsWith("windows") -> {
                // ES_CONTINUOUS | ES_SYSTEM_REQUIRED holds until this thread exits, which Wait-Process ties to the IDE.
                val script = "Add-Type -Namespace CodeM -Name Power -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags);'; " +
                    "if ([CodeM.Power]::SetThreadExecutionState([uint32]\"0x80000001\") -eq 0) { exit 3 }; Wait-Process -Id $pid"
                listOf("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
            }
            else -> null
        }
    }
}

/**
 * Owns the one inhibitor process of this IDE. The state lives only in memory: restarting the IDE or unloading the
 * plugin ends the process and starts with keep-awake off. [publish] is called after every change of [on], including
 * the one after an unexpected exit; calls from racing threads may arrive out of order, so a listener reads [on] rather
 * than trusting the argument. [failed] reports an inhibitor that could not start or stopped on its own, after [on] is
 * already false. Both run without the lock held.
 */
class KeepAwake(
    private val command: List<String>?,
    private val publish: (on: Boolean) -> Unit,
    private val failed: (message: String) -> Unit,
    private val start: (List<String>) -> Process = { args ->
        ProcessBuilder(args).redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start()
    },
) {
    private val lock = Any()
    private var process: Process? = null

    val on: Boolean get() = synchronized(lock) { process != null }
    val supported: Boolean get() = command != null

    fun toggle() {
        if (on) disable() else enable()
    }

    fun enable() {
        val args = command ?: return failed("当前系统不支持防休眠。")
        val outcome = synchronized(lock) {
            if (process != null) return
            runCatching { start(args) }.onSuccess { process = it }
        }
        val child = outcome.getOrElse { error -> return failed(startFailure(args.first(), error)) }
        publish(true)
        // Registered after publishing, so an inhibitor that exits at once still reports off after on.
        child.onExit().thenAccept { exited ->
            val code = exited.exitValue()
            lost(exited, if (code == 0) "防休眠已意外停止。" else "防休眠已停止：${args.first()} 退出码 $code。")
        }
    }

    fun disable() {
        val child = synchronized(lock) { process.also { process = null } } ?: return
        child.destroy()
        publish(false)
    }

    fun dispose() = disable()

    /** Only the current process may report; a stale exit after disable or a restart changes nothing. */
    private fun lost(child: Process, message: String) {
        synchronized(lock) {
            if (process !== child) return
            process = null
        }
        publish(false)
        failed(message)
    }

    private fun startFailure(command: String, error: Throwable): String {
        val missing = error is IOException && (error.message.orEmpty().contains("error=2") || error.message.orEmpty().contains("No such file"))
        return if (missing) "无法开启防休眠：未找到 $command。" else "无法开启防休眠：${error.message ?: error.javaClass.simpleName}"
    }
}
