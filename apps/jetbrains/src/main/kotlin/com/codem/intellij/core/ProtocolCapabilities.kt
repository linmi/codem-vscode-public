package com.codem.intellij.core

object ProtocolCapabilities {
    const val PROTOCOL_VERSION = 1

    val requiredBooleans: List<String> = listOf(
        "threads.list",
        "threads.read",
        "threads.fork",
        "threads.archive",
        "threads.delete",
        "threads.setName",
        "threads.compact",
        "threads.turnsList",
        "threads.itemsList",
        "threads.shellCommand",
        "threads.backgroundTerminals",
        "threads.backgroundTaskCancel",
        "threads.rewind",
        "threads.initialPlanMode",
        "threads.modelSelection",
        "threads.sessionModes",
        "turns.steer",
        "turns.interrupt",
        "turns.attachments",
        "items.streaming",
        "clientRequests.commandExecutionApproval",
        "clientRequests.fileChangeApproval",
        "clientRequests.permissionsApproval",
        "clientRequests.planApproval",
        "clientRequests.rewindSelection",
        "clientRequests.userInput",
        "controlPlane.configRead",
        "controlPlane.environment",
        "controlPlane.hooks",
        "controlPlane.models",
        "controlPlane.permissionProfiles",
        "controlPlane.plugins",
        "controlPlane.skills",
        "controlPlane.spaces",
        "controlPlane.tools",
        "mcp.stdio",
    )

    val requiredItemTypes: List<String> = listOf(
        "userMessage",
        "agentMessage",
        "reasoning",
        "commandExecution",
        "fileChange",
        "mcpToolCall",
        "webSearch",
        "contextCompaction",
        "toolCall",
        "subagent",
    )

    val requiredItemStatuses: List<String> = listOf("inProgress", "completed", "failed", "declined", "interrupted")

    data class Initialization(val protocolVersion: Int, val agentVersion: String)

    fun validateInitialize(result: JsonValue, expectedCoreVersion: String): Initialization {
        val obj = result.asObject()
        val protocol = obj.fields["protocolVersion"]
        val protocolNumber = (protocol as? JsonValue.NumberValue)?.value?.toInt()
        if (protocolNumber != PROTOCOL_VERSION) {
            throw CodemError.Protocol(CodemError.Class.Capability, "CodeM App Server protocol ${protocol} is not supported; expected $PROTOCOL_VERSION")
        }
        val capabilities = obj.required("capabilities").asObject()
        for (path in requiredBooleans) {
            if (nested(capabilities, path) != JsonValue.Bool(true)) {
                throw CodemError.Protocol(CodemError.Class.Capability, "CodeM App Server is missing required capability $path=true")
            }
        }
        requireMembers(capabilities, "items.types", requiredItemTypes)
        requireMembers(capabilities, "items.statuses", requiredItemStatuses)
        val agentInfo = obj.required("agentInfo").asObject()
        val version = agentInfo.required("version").asText().trim()
        if (version.isEmpty()) throw CodemError.Protocol(CodemError.Class.Capability, "CodeM App Server initialize agentInfo.version must be non-empty")
        val runtimeVersion = Regex("""^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?$""").find(version)?.groupValues?.get(1)
        if (runtimeVersion != expectedCoreVersion) {
            throw CodemError.Protocol(CodemError.Class.Capability, "CodeM App Server Core is $expectedCoreVersion, but initialize reports $version")
        }
        return Initialization(PROTOCOL_VERSION, version)
    }

    private fun requireMembers(capabilities: JsonValue.ObjectValue, path: String, required: List<String>) {
        val value = nested(capabilities, path) as? JsonValue.ArrayValue
            ?: throw CodemError.Protocol(CodemError.Class.Capability, "CodeM App Server capability $path must be an array")
        val items = value.items.mapNotNull { (it as? JsonValue.Text)?.value }
        for (member in required) {
            if (member !in items) throw CodemError.Protocol(CodemError.Class.Capability, "CodeM App Server capability $path is missing $member")
        }
    }

    private fun nested(value: JsonValue, path: String): JsonValue? {
        var current: JsonValue? = value
        for (segment in path.split('.')) {
            current = (current as? JsonValue.ObjectValue)?.fields?.get(segment) ?: return null
        }
        return current
    }
}
