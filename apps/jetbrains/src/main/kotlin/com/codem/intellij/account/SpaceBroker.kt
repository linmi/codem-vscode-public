package com.codem.intellij.account

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue
import com.codem.intellij.core.ResolvedRuntime
import com.codem.intellij.core.RpcPeer
import com.codem.intellij.core.Timeouts
import java.nio.file.Path
import java.util.concurrent.TimeUnit

data class Space(val projectKey: String, val displayName: String)
data class SpaceList(val current: String?, val spaces: List<Space>)
data class PreparedSpace(val projectKey: String, val displayName: String, val managedDirectory: String?)

sealed class SpacePreparation {
    data class Prepared(val catalog: SpaceList, val space: PreparedSpace) : SpacePreparation()
    data class SelectionRequired(val catalog: SpaceList) : SpacePreparation()
}

/**
 * CLI `__host-serve` 空间 broker。不调用 space_commit。
 * 用户等待前必须关闭 broker；启动材料只消费一次。
 */
class SpaceBroker(
    private val runtime: ResolvedRuntime,
    private val workingDirectory: Path,
    private val environment: Map<String, String> = emptyMap(),
    private val timeouts: Timeouts = Timeouts(),
    private val openPeer: (List<String>, Path, Map<String, String>) -> BrokerSession = ::javaBrokerSession,
) : SpaceGateway {
    fun list(): SpaceList = withBroker("project_list") { call -> parseSpaces(call("project_list", JsonValue.ObjectValue(emptyMap()))) }

    override fun prepare(projectKey: String): PreparedSpace {
        spaceKey(projectKey)
        return withBroker("space_prepare") { call -> parsePrepared(call("space_prepare", JsonValue.obj("project_key" to JsonValue.Text(projectKey))), projectKey) }
    }

    override fun prepareInitial(requestedKey: String?): SpacePreparation {
        if (requestedKey != null) spaceKey(requestedKey)
        return withBroker("project_list") { call ->
            val catalog = parseSpaces(call("project_list", JsonValue.ObjectValue(emptyMap())))
            val key = requestedKey ?: catalog.current
            if (key == null || catalog.spaces.none { it.projectKey == key }) return@withBroker SpacePreparation.SelectionRequired(catalog)
            SpacePreparation.Prepared(catalog, parsePrepared(call("space_prepare", JsonValue.obj("project_key" to JsonValue.Text(key))), key))
        }
    }

    override fun launchArguments(space: PreparedSpace): Pair<List<String>, Map<String, String>> {
        spaceKey(space.projectKey)
        if (space.managedDirectory != null && !isAbsoluteManagedDirectory(space.managedDirectory)) {
            throw CodemError.Validation("Invalid CodeM managed directory")
        }
        return listOf("--project-key", space.projectKey) to mapOf("CODEM_MANAGED_DIR" to (space.managedDirectory ?: ""))
    }

    private fun <T> withBroker(label: String, run: ((String, JsonValue.ObjectValue) -> JsonValue.ObjectValue) -> T): T {
        if (!workingDirectory.isAbsolute) throw CodemError.Validation("CodeM space workingDirectory must be absolute")
        val session = openPeer(listOf(runtime.authExecutable.toString(), "__host-serve"), workingDirectory, environment)
        try {
            val initialized = session.request("initialize", JsonValue.obj(
                "protocolVersion" to JsonValue.Text("2025-03-26"),
                "capabilities" to JsonValue.ObjectValue(emptyMap()),
                "clientInfo" to JsonValue.obj("name" to JsonValue.Text("codem-editor-spaces"), "version" to JsonValue.Text("1")),
            )).get(timeouts.spaceBrokerMs, TimeUnit.MILLISECONDS).asObject()
            val server = initialized.required("serverInfo").asObject()
            if (initialized.required("protocolVersion").asText() != "2025-03-26" ||
                server.required("name").asText() != "codem__host" ||
                server.required("version").asText() != runtime.cliVersion
            ) {
                throw CodemError.Authentication("CodeM space broker version/protocol mismatch; reinstall the pinned runtime")
            }
            session.notify("notifications/initialized")
            return run { name, args ->
                val result = session.request("tools/call", JsonValue.obj("name" to JsonValue.Text(name), "arguments" to args))
                    .get(timeouts.spaceBrokerMs, TimeUnit.MILLISECONDS)
                    .asObject()
                if (result.fields["isError"] == JsonValue.Bool(true)) {
                    throw CodemError.Authentication("CodeM $name broker rejected the request; refresh your login and retry")
                }
                val content = result.required("content").asArray().items.singleOrNull()?.asObject()
                    ?: throw CodemError.Authentication("Invalid CodeM $name response")
                if (content.required("type").asText() != "text") throw CodemError.Authentication("Invalid CodeM $name response")
                val payload = JsonValue.parse(content.required("text").asText()).asObject()
                if (payload.fields["ok"] != JsonValue.Bool(true)) {
                    throw CodemError.Authentication("CodeM $name failed; refresh your space list and login before retrying")
                }
                payload
            }
        } catch (error: CodemError) {
            throw error
        } catch (error: Exception) {
            throw CodemError.Authentication("CodeM $label broker rejected the request; refresh your login and retry", error)
        } finally {
            session.close()
        }
    }
}

fun parseSpaces(payload: JsonValue.ObjectValue): SpaceList {
    val projects = payload.fields["projects"] as? JsonValue.ArrayValue ?: throw CodemError.Validation("Invalid CodeM space list")
    val spaces = projects.items.map { entry ->
        val project = entry.asObject()
        Space(spaceKey(project.required("project_key").asText()), textValue(project.required("display_name").asText(), "space name"))
    }
    if (spaces.map { it.projectKey }.toSet().size != spaces.size) throw CodemError.Validation("CodeM space list contains duplicate spaces")
    val current = when (val value = payload.fields["current"]) {
        null, JsonValue.Null -> null
        is JsonValue.Text -> spaceKey(value.value)
        else -> throw CodemError.Validation("Invalid CodeM current space")
    }
    if (current != null && spaces.none { it.projectKey == current }) throw CodemError.Validation("CodeM current space is absent from its space list")
    return SpaceList(current, spaces)
}

fun parsePrepared(payload: JsonValue.ObjectValue, projectKey: String): PreparedSpace {
    if (payload.fields["project_key"] !is JsonValue.Text || (payload.fields["project_key"] as JsonValue.Text).value != projectKey) {
        throw CodemError.Validation("CodeM space_prepare returned an invalid space or status")
    }
    val status = (payload.fields["status"] as? JsonValue.Text)?.value
    if (status != "ok" && status != "empty") throw CodemError.Validation("CodeM space_prepare returned an invalid space or status")
    val directory = when (val value = payload.fields["managed_dir"]) {
        null, JsonValue.Null -> null
        is JsonValue.Text -> if (!isAbsoluteManagedDirectory(value.value)) throw CodemError.Validation("CodeM space_prepare returned an invalid managed directory") else value.value
        else -> throw CodemError.Validation("CodeM space_prepare returned an invalid managed directory")
    }
    return PreparedSpace(projectKey, textValue(payload.required("project_name").asText(), "space name"), directory)
}

/** Windows 盘符/UNC 与 Unix 根路径都算绝对路径，不把「以 / 开头」当成唯一依据。 */
fun isAbsoluteManagedDirectory(value: String): Boolean {
    if (value.isEmpty() || '\u0000' in value) return false
    if (value.startsWith("/")) return true
    if (value.startsWith("\\\\")) return true
    return value.length >= 3 &&
        value[0].isLetter() &&
        value[1] == ':' &&
        (value[2] == '\\' || value[2] == '/')
}

fun spaceKey(value: String): String {
    if (!value.matches(Regex("^[a-zA-Z0-9_-]+$"))) throw CodemError.Validation("Invalid CodeM space key")
    return value
}

private fun textValue(value: String, label: String): String {
    if (value.isBlank() || value.any { it.code < 32 || it.code == 127 }) throw CodemError.Validation("Invalid CodeM $label")
    return value
}

interface BrokerSession {
    fun request(method: String, params: JsonValue.ObjectValue): java.util.concurrent.CompletableFuture<JsonValue>
    fun notify(method: String)
    fun close()
}

fun javaBrokerSession(command: List<String>, cwd: Path, environment: Map<String, String>): BrokerSession {
    val builder = ProcessBuilder(command).directory(cwd.toFile())
    builder.environment().putAll(environment)
    val process = builder.start()
    val stdin = process.outputStream.bufferedWriter()
    val peer = RpcPeer(
        writeLine = { line ->
            synchronized(stdin) {
                stdin.write(line)
                stdin.write("\n")
                stdin.flush()
            }
        },
        onNotification = { throw CodemError.Authentication("CodeM space broker sent an unexpected notification") },
        onRequest = { throw CodemError.Authentication("CodeM space broker sent an unexpected request") },
        onProtocolError = { throw it },
    )
    Thread {
        process.inputStream.bufferedReader().use { reader ->
            while (true) {
                val line = reader.readLine() ?: break
                if (line.isNotBlank()) peer.consume(line)
            }
        }
    }.apply { isDaemon = true; name = "codem-space-broker" }.start()
    Thread {
        process.errorStream.use { it.readAllBytes() }
    }.apply { isDaemon = true; name = "codem-space-broker-stderr" }.start()
    return object : BrokerSession {
        override fun request(method: String, params: JsonValue.ObjectValue) = peer.request(method, params)
        override fun notify(method: String) = peer.notify(method)
        override fun close() {
            try {
                stdin.close()
            } catch (_: Exception) {
            }
            process.destroy()
            if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly()
            peer.close()
        }
    }
}
