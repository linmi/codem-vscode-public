package com.codem.intellij.session

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue

/**
 * B01–B14 的领域请求构造。结果不明时禁止自动重试。
 * compact 若上游仍缺终态，调用方必须保留停止/诊断，不能把 warning 转成功。
 */
object ThreadCommands {
    fun rename(threadId: String, name: String, cwd: String): Pair<String, JsonValue.ObjectValue> =
        "thread/name/set" to JsonValue.obj(
            "threadId" to JsonValue.Text(threadId),
            "name" to JsonValue.Text(name),
            "cwd" to JsonValue.Text(cwd),
        )

    fun archive(threadId: String, archived: Boolean, cwd: String): Pair<String, JsonValue.ObjectValue> =
        (if (archived) "thread/archive" else "thread/unarchive") to JsonValue.obj(
            "threadId" to JsonValue.Text(threadId),
            "cwd" to JsonValue.Text(cwd),
        )

    fun delete(threadId: String, cwd: String): Pair<String, JsonValue.ObjectValue> =
        "thread/delete" to JsonValue.obj("threadId" to JsonValue.Text(threadId), "cwd" to JsonValue.Text(cwd))

    fun fork(threadId: String, cwd: String): Pair<String, JsonValue.ObjectValue> =
        "thread/fork" to JsonValue.obj("threadId" to JsonValue.Text(threadId), "cwd" to JsonValue.Text(cwd))

    fun clear(
        threadId: String,
        operationId: String,
        cwd: String,
        model: String,
        intelligence: String,
        workMode: String,
        directories: List<String>,
    ): Pair<String, JsonValue.ObjectValue> =
        "thread/clear" to JsonValue.obj(
            "threadId" to JsonValue.Text(threadId),
            "operationId" to JsonValue.Text(operationId),
            "cwd" to JsonValue.Text(cwd),
            "model" to JsonValue.obj("id" to JsonValue.Text(model), "intelligence" to JsonValue.Text(intelligence)),
            "additionalDirectories" to JsonValue.ArrayValue(directories.map { JsonValue.Text(it) }),
            "mcpServers" to JsonValue.ArrayValue(emptyList()),
            "executionMode" to JsonValue.Text(workMode),
        )

    fun listThreads(cwd: String, cursor: String?): Pair<String, JsonValue.ObjectValue> {
        val fields = linkedMapOf("cwd" to JsonValue.Text(cwd))
        if (cursor != null) fields["cursor"] = JsonValue.Text(cursor)
        return "thread/list" to JsonValue.ObjectValue(fields)
    }

    fun resume(threadId: String, cwd: String, model: String, intelligence: String, directories: List<String>): Pair<String, JsonValue.ObjectValue> =
        "thread/resume" to JsonValue.obj(
            "threadId" to JsonValue.Text(threadId),
            "cwd" to JsonValue.Text(cwd),
            "model" to JsonValue.Text(model),
            "extensions" to JsonValue.obj("codem" to JsonValue.obj("intelligence" to JsonValue.Text(intelligence))),
            "additionalDirectories" to JsonValue.ArrayValue(directories.map { JsonValue.Text(it) }),
            "mcpServers" to JsonValue.ArrayValue(emptyList()),
        )

    fun compact(threadId: String): Pair<String, JsonValue.ObjectValue> =
        "thread/compact/start" to JsonValue.obj("threadId" to JsonValue.Text(threadId))

    fun rewind(threadId: String): Pair<String, JsonValue.ObjectValue> =
        "thread/rewind/start" to JsonValue.obj("threadId" to JsonValue.Text(threadId))

    fun steer(threadId: String, turnId: String, submissionId: String, text: String): Pair<String, JsonValue.ObjectValue> =
        "turn/steer" to JsonValue.obj(
            "threadId" to JsonValue.Text(threadId),
            "expectedTurnId" to JsonValue.Text(turnId),
            "submissionId" to JsonValue.Text(submissionId),
            "input" to JsonValue.Text(text),
            "attachments" to JsonValue.ArrayValue(emptyList()),
        )

    fun sideQuestion(threadId: String, question: String): Pair<String, JsonValue.ObjectValue> =
        "thread/sideQuestion/start" to JsonValue.obj("threadId" to JsonValue.Text(threadId), "question" to JsonValue.Text(question.trim()))

    fun cancelSideQuestion(threadId: String, sideQuestionId: String): Pair<String, JsonValue.ObjectValue> =
        "thread/sideQuestion/cancel" to JsonValue.obj("threadId" to JsonValue.Text(threadId), "sideQuestionId" to JsonValue.Text(sideQuestionId))

    fun skillInput(name: String, arguments: String?): JsonValue.ObjectValue {
        val fields = linkedMapOf("type" to JsonValue.Text("skill"), "name" to JsonValue.Text(name))
        if (arguments != null) fields["arguments"] = JsonValue.Text(arguments)
        return JsonValue.ObjectValue(fields)
    }

    fun rejectSkillWithAttachments() {
        throw CodemError.Validation("Skill submissions must not include attachments")
    }

    fun shellCommand(threadId: String, command: String): Pair<String, JsonValue.ObjectValue> =
        "thread/shellCommand" to JsonValue.obj("threadId" to JsonValue.Text(threadId), "command" to JsonValue.Text(command))

    fun backgroundTerminals(threadId: String): Pair<String, JsonValue.ObjectValue> =
        "thread/backgroundTerminals/list" to JsonValue.obj("threadId" to JsonValue.Text(threadId))

    fun terminateBackground(threadId: String, processId: Int): Pair<String, JsonValue.ObjectValue> =
        "thread/backgroundTerminals/terminate" to JsonValue.obj("threadId" to JsonValue.Text(threadId), "processId" to JsonValue.NumberValue(processId.toDouble(), processId.toString()))

    fun cleanBackground(threadId: String): Pair<String, JsonValue.ObjectValue> =
        "thread/backgroundTerminals/clean" to JsonValue.obj("threadId" to JsonValue.Text(threadId))

    fun cancelBackgroundTask(threadId: String, taskId: String): Pair<String, JsonValue.ObjectValue> =
        "thread/backgroundTask/cancel" to JsonValue.obj("threadId" to JsonValue.Text(threadId), "taskId" to JsonValue.Text(taskId))

    fun mcpStdio(name: String, command: String, args: List<String>): JsonValue.ObjectValue =
        JsonValue.obj(
            "type" to JsonValue.Text("stdio"),
            "name" to JsonValue.Text(name),
            "command" to JsonValue.Text(command),
            "args" to JsonValue.ArrayValue(args.map { JsonValue.Text(it) }),
        )

    /** A03：与 Node host.readModes / setModes 对齐。UI workMode default 对应 Core normal。 */
    fun readModes(threadId: String): Pair<String, JsonValue.ObjectValue> =
        "thread/mode/read" to JsonValue.obj("threadId" to JsonValue.Text(threadId))

    fun setModes(
        threadId: String,
        expectedRevision: Int,
        permissionMode: String?,
        workMode: String?,
    ): Pair<String, JsonValue.ObjectValue> {
        if (permissionMode == null && workMode == null) throw CodemError.Validation("CodeM thread/mode/set requires a mode change")
        val fields = linkedMapOf(
            "threadId" to JsonValue.Text(threadId),
            "expectedRevision" to JsonValue.NumberValue(expectedRevision.toDouble(), expectedRevision.toString()),
        )
        if (permissionMode != null) fields["permissionMode"] = JsonValue.Text(permissionMode)
        if (workMode != null) fields["workMode"] = JsonValue.Text(workMode)
        return "thread/mode/set" to JsonValue.ObjectValue(fields)
    }

    fun skills(cwd: String, threadId: String?): Pair<String, JsonValue.ObjectValue> {
        val fields = linkedMapOf("cwd" to JsonValue.Text(cwd))
        if (threadId != null) fields["threadId"] = JsonValue.Text(threadId)
        return "skills/list" to JsonValue.ObjectValue(fields)
    }

    fun environmentInfo(cwd: String): Pair<String, JsonValue.ObjectValue> =
        "environment/info" to JsonValue.obj("cwd" to JsonValue.Text(cwd))

    fun configRead(cwd: String): Pair<String, JsonValue.ObjectValue> =
        "config/read" to JsonValue.obj("cwd" to JsonValue.Text(cwd))

    fun hooksList(cwd: String): Pair<String, JsonValue.ObjectValue> =
        "hooks/list" to JsonValue.obj("cwd" to JsonValue.Text(cwd))

    fun pluginList(cwd: String): Pair<String, JsonValue.ObjectValue> =
        "plugin/list" to JsonValue.obj("cwd" to JsonValue.Text(cwd))

    fun permissionProfiles(cwd: String): Pair<String, JsonValue.ObjectValue> =
        "permissionProfile/list" to JsonValue.obj("cwd" to JsonValue.Text(cwd))

    fun spaceList(cwd: String): Pair<String, JsonValue.ObjectValue> =
        "space/list" to JsonValue.obj("cwd" to JsonValue.Text(cwd))

    fun modelList(cwd: String): Pair<String, JsonValue.ObjectValue> =
        "model/list" to JsonValue.obj("cwd" to JsonValue.Text(cwd))

    fun modelProvider(cwd: String): Pair<String, JsonValue.ObjectValue> =
        "modelProvider/capabilities/read" to JsonValue.obj("cwd" to JsonValue.Text(cwd))

    fun toolsList(threadId: String): Pair<String, JsonValue.ObjectValue> =
        "tools/list" to JsonValue.obj("threadId" to JsonValue.Text(threadId))

    fun loadedThreads(cwd: String): Pair<String, JsonValue.ObjectValue> =
        "thread/loaded/list" to JsonValue.obj("cwd" to JsonValue.Text(cwd))

    fun liveTurns(threadId: String, cursor: Int?, limit: Int = 50): Pair<String, JsonValue.ObjectValue> {
        if (limit != 50) throw CodemError.Validation("live snapshot limit must be 50")
        val fields = linkedMapOf("threadId" to JsonValue.Text(threadId), "limit" to JsonValue.NumberValue(50.0, "50"))
        if (cursor != null) {
            if (cursor < 0) throw CodemError.Validation("live snapshot cursor must be a non-negative integer")
            fields["cursor"] = JsonValue.NumberValue(cursor.toDouble(), cursor.toString())
        }
        return "thread/turns/list" to JsonValue.ObjectValue(fields)
    }
}
