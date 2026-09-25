package com.codem.intellij.session

import com.codem.intellij.core.JsonValue
import com.codem.intellij.webview.CatalogRowView
import com.codem.intellij.webview.ChatMessageView
import com.codem.intellij.webview.ToolDetailsView

/**
 * 一轮内的思考/工具投影，对标 VS Code upsertActivity。
 * 不另建 transcript；只在 TurnAccumulator 里活着，turn/completed 后写入 messages。
 */
data class TurnActivity(
    val id: String,
    val role: String,
    var label: String,
    var status: String,
    val text: StringBuilder = StringBuilder(),
    var summary: String = "",
    var details: ToolDetailsView? = null,
) {
    fun toMessage(turnId: String): ChatMessageView =
        ChatMessageView(
            id = id,
            role = role,
            text = text.toString(),
            turnId = turnId,
            label = label,
            status = status,
            summary = summary,
            details = details,
        )
}

/**
 * 只投影 Host 边界内的安全字段：名称、命令、路径、查询。
 * 不转发 env/headers/token，也不把工具输出当标题。
 */
object ToolDetailsProjection {
    fun project(name: String, input: JsonValue.ObjectValue?): ToolDetailsView? {
        val obj = input ?: return null
        val fields = mutableListOf<CatalogRowView>()
        fun add(label: String, key: String) {
            val value = textOf(obj.fields[key])?.take(400) ?: return
            if (value.isNotBlank() && fields.none { it.label == label && it.detail == value }) {
                fields += CatalogRowView(label, value)
            }
        }
        val command = textOf(obj.fields["command"])?.take(8000)
        when (name) {
            "run_bash", "verify" -> {
                add("超时", "timeout")
                return ToolDetailsView("command", fields, command)
            }
            "read_files", "write_file", "edit_file", "multi_edit", "patch_file", "list_dir" -> {
                addFiles(obj, fields)
                add("文件", "path")
                add("目录", "path")
                return if (fields.isEmpty()) null else ToolDetailsView("file", fields, null)
            }
            "grep", "glob", "search_and_read", "web_search", "tool_search" -> {
                add("查询", "pattern")
                add("查询", "query")
                add("范围", "path")
                add("匹配文件", "glob")
                return ToolDetailsView("search", fields, null)
            }
            "web_fetch" -> {
                add("地址", "url")
                return ToolDetailsView("web", fields, null)
            }
            "dispatch" -> {
                add("任务", "label")
                add("代理", "agent")
                return ToolDetailsView("subagent", fields, null)
            }
            else -> {
                add("文件", "path")
                add("查询", "query")
                add("查询", "pattern")
                if (fields.isEmpty() && command.isNullOrBlank()) return null
                return ToolDetailsView("command", fields, command)
            }
        }
    }

    private fun addFiles(obj: JsonValue.ObjectValue, fields: MutableList<CatalogRowView>) {
        val files = obj.arrayOrNull("files") ?: return
        // Tool arguments are free-form: entries that are not objects are skipped, not an error.
        for (file in files.take(50).filterIsInstance<JsonValue.ObjectValue>()) {
            val path = textOf(file.fields["path"]) ?: continue
            if (path.isNotBlank()) fields += CatalogRowView("文件", path.take(400))
        }
    }

    private fun textOf(value: JsonValue?): String? = when (value) {
        is JsonValue.Text -> value.value
        is JsonValue.NumberValue -> value.literal
        is JsonValue.Bool -> if (value.value) "是" else "否"
        else -> null
    }
}
