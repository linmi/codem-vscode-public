package com.codem.intellij.ide

import com.codem.intellij.bootstrap.ToolWindowHost
import com.codem.intellij.core.CodemError
import com.codem.intellij.session.SafeNotice
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.InputValidatorEx
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.wm.ToolWindowManager
import java.awt.datatransfer.StringSelection
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 描述 → 生成一行 → 预览 → 插入终端。插入从不按回车，由用户自己运行、修改或丢弃；同一时间只有一次生成。
 * 生成借用已连接聊天的旁路提问，不开 Agent 轮次；未连接或聊天正忙时明确提示，不替用户连接。
 */
class GenerateTerminalCommandAction : AnAction(), DumbAware {
    private val log = Logger.getInstance(GenerateTerminalCommandAction::class.java)
    private val running = AtomicBoolean(false)

    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        if (running.get()) {
            Messages.showInfoMessage(project, "正在生成终端命令，可在进度条中取消。", TITLE)
            return
        }
        val host = ToolWindowHost.of(project) ?: run {
            ToolWindowManager.getInstance(project).getToolWindow("CodeM")?.activate(null)
            Messages.showInfoMessage(project, "请先在 CodeM 中登录并连接，再生成终端命令。", TITLE)
            return
        }
        val request = Messages.showInputDialog(
            project,
            "描述要在终端中完成的操作。生成后先预览，插入终端也不会自动执行。\n例如：列出最近 7 天修改过的 Kotlin 文件",
            TITLE,
            null,
            "",
            LengthValidator,
        ) ?: return
        if (request.isBlank()) return
        val prompt = try {
            TerminalCommand.prompt(request, TerminalCommandContext(platform(), shell(), null))
        } catch (error: CodemError) {
            Messages.showErrorDialog(project, SafeNotice.from(error, FAILED), TITLE)
            return
        }
        if (!running.compareAndSet(false, true)) return
        val started = System.nanoTime()
        object : Task.Backgroundable(project, "CodeM 正在生成终端命令", true) {
            private var line: String? = null

            override fun run(indicator: ProgressIndicator) {
                line = TerminalCommand.parse(host.generateText(prompt) { indicator.isCanceled })
            }

            override fun onSuccess() {
                line?.let { offer(project, it) }
            }

            override fun onThrowable(error: Throwable) {
                if (error is CodemError.Cancelled && error.message == com.codem.intellij.session.SideGenerations.CANCELLED) return
                log.warn("CodeM terminal command generation failed", error)
                Messages.showErrorDialog(project, SafeNotice.from(error, FAILED), TITLE)
            }

            override fun onFinished() {
                running.set(false)
                log.info("CodeM terminal command generation ${(System.nanoTime() - started) / 1_000_000}ms")
            }
        }.queue()
    }

    private fun offer(project: Project, line: String) {
        val terminal = terminalAvailable()
        val options = if (terminal) arrayOf("插入终端", "复制", "取消") else arrayOf("复制", "取消")
        val detail = if (terminal) "插入后不会自动执行，请确认后自行按回车。" else "未启用内置终端插件，只能复制后自行粘贴。"
        val choice = Messages.showDialog(project, "$line\n\n$detail", "将生成的命令插入终端？", options, 0, Messages.getQuestionIcon())
        when (options.getOrNull(choice)) {
            "插入终端" -> TerminalInsertion.insert(project, line)
            "复制" -> CopyPasteManager.getInstance().setContents(StringSelection(line))
        }
    }

    private fun terminalAvailable(): Boolean {
        val plugin = PluginManagerCore.getPlugin(PluginId.getId("org.jetbrains.plugins.terminal")) ?: return false
        return !PluginManagerCore.isDisabled(plugin.pluginId)
    }

    private object LengthValidator : InputValidatorEx {
        override fun checkInput(inputString: String?): Boolean = (inputString?.length ?: 0) <= TerminalCommand.MAX_REQUEST
        override fun canClose(inputString: String?): Boolean = checkInput(inputString)
        override fun getErrorText(inputString: String?): String? =
            if (checkInput(inputString)) null else "描述超过 2000 字符，请精简。"
    }

    private fun platform(): String {
        val os = System.getProperty("os.name").lowercase()
        return when {
            os.startsWith("mac") -> "darwin"
            os.startsWith("windows") -> "win32"
            else -> "linux"
        }
    }

    private fun shell(): String {
        if (platform() == "win32") return "powershell.exe"
        return System.getenv("SHELL")?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: "unknown"
    }

    companion object {
        private const val TITLE = "生成终端命令"
        private const val FAILED = "终端命令生成失败，请重试。"
    }
}
