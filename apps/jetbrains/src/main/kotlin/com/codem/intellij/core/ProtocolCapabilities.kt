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
        val protocol = obj.optional("protocolVersion")
        // Exactly the number 1, as preflight.ts compares it; 1.5 must not truncate to a supported version.
        if (obj.numberOrNull("protocolVersion") != PROTOCOL_VERSION.toDouble()) {
            throw CodemError.Protocol(CodemError.Class.Capability, "CodeM App Server protocol ${protocol} is not supported; expected $PROTOCOL_VERSION")
        }
        val capabilities = obj.required("capabilities").asObject()
        for (path in requiredBooleans) {
            if (parent(capabilities, path)?.booleanOrNull(leaf(path)) != true) {
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
        val items = parent(capabilities, path)?.arrayOrNull(leaf(path))
            ?: throw CodemError.Protocol(CodemError.Class.Capability, "CodeM App Server capability $path must be an array")
        for (member in required) {
            if (JsonValue.Text(member) !in items) throw CodemError.Protocol(CodemError.Class.Capability, "CodeM App Server capability $path is missing $member")
        }
    }

    /** The object holding the last segment of a dotted capability path, or null when a segment on the way is not an object. */
    private fun parent(capabilities: JsonValue.ObjectValue, path: String): JsonValue.ObjectValue? =
        path.split('.').dropLast(1).fold<String, JsonValue.ObjectValue?>(capabilities) { current, segment -> current?.objectOrNull(segment) }

    private fun leaf(path: String): String = path.substringAfterLast('.')
}
