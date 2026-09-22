package com.codem.intellij.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path

class RuntimeLocatorTest {
    @Test
    fun lockedVersionsMatchContractsManifest() {
        val candidates = listOf(
            Path.of("packages/contracts/manifest.json"),
            Path.of("../../packages/contracts/manifest.json"),
        )
        val manifestPath = candidates.first { Files.isRegularFile(it) }
        val manifest = JsonValue.parse(Files.readString(manifestPath)).asObject()
        assertEquals(RuntimeLocator.CORE_VERSION, manifest.required("coreVersion").asText())
        assertEquals(RuntimeLocator.CLI_VERSION, manifest.required("cliVersion").asText())
        assertEquals(ProtocolCapabilities.PROTOCOL_VERSION.toDouble(), (manifest.required("protocolVersion") as JsonValue.NumberValue).value)
        assertEquals(13.0, (manifest.required("historySchema") as JsonValue.NumberValue).value)
        assertEquals("2025-03-26", manifest.required("spaceBrokerProtocol").asText())
        val client = manifest.required("clientInfo").asObject().required("jetbrains").asObject()
        assertEquals("codem-intellij", client.required("name").asText())
        assertEquals("0.1.0", client.required("version").asText())
    }

    @Test
    fun bundleResolvesWithoutWorkspaceOrNode(@org.junit.jupiter.api.io.TempDir root: Path) {
        writeBundle(root)
        val resolved = RuntimeLocator.resolveFromPlugin(root)
        assertEquals(RuntimeLocator.CORE_VERSION, resolved.coreVersion)
        assertEquals(RuntimeLocator.CLI_VERSION, resolved.cliVersion)
        assertTrue(resolved.coreExecutable.startsWith(root.toRealPath()))
        assertTrue(resolved.authExecutable.startsWith(root.toRealPath()))
    }

    @Test
    fun missingBundleRejectsWorkspaceLayoutAndOldManifest(@org.junit.jupiter.api.io.TempDir root: Path) {
        Files.createDirectories(root.resolve("node_modules/@lark-codem/codem-core"))
        Files.createDirectories(root.resolve("runtime"))
        Files.writeString(root.resolve("runtime/manifest.json"), "{}")
        assertThrows(CodemError::class.java) { RuntimeLocator.resolveFromPlugin(root) }
    }

    @Test
    fun rejectsWrongSchemaVersionsTargetPackagesAndPaths(@org.junit.jupiter.api.io.TempDir root: Path) {
        val baseline = writeBundle(root)
        val invalid = mapOf(
            "schemaVersion" to listOf(JsonValue.NumberValue(2.1, "2.1"), JsonValue.NumberValue(1.0, "1"), JsonValue.Text("2")),
            "target" to listOf(JsonValue.Text("unsupported-arch")),
            "coreVersion" to listOf(JsonValue.Text("0.8.37")),
            "cliVersion" to listOf(JsonValue.Text("0.1.207")),
            "packageName" to listOf(JsonValue.Text("wrong-core")),
            "authPackageName" to listOf(JsonValue.Text("wrong-auth")),
            "executableName" to listOf(JsonValue.Text("../../outside"), JsonValue.Text("/tmp/codem-core")),
            "authExecutableName" to listOf(JsonValue.Text("../outside"), JsonValue.Text("codem")),
            "sha256" to listOf(JsonValue.Text("00"), JsonValue.Text("0".repeat(64))),
            "authSha256" to listOf(JsonValue.Text("00"), JsonValue.Text("0".repeat(64))),
        )
        for ((field, values) in invalid) {
            for (value in values + JsonValue.Null) {
                writeManifest(root, JsonValue.ObjectValue(baseline.fields + (field to value)))
                assertThrows(CodemError::class.java, { RuntimeLocator.resolveFromPlugin(root) }, field)
            }
            writeManifest(root, JsonValue.ObjectValue(baseline.fields - field))
            assertThrows(CodemError::class.java, { RuntimeLocator.resolveFromPlugin(root) }, "missing $field")
        }
    }

    @Test
    fun rejectsMissingAndTamperedArtifacts(@org.junit.jupiter.api.io.TempDir root: Path) {
        for (name in listOf(RuntimeLocator.targets.getValue(RuntimeLocator.currentTargetId()).executableName,
            authName(), "LICENSE.core", "LICENSE.auth")) {
            writeBundle(root)
            Files.delete(root.resolve("bin/app-server/$name"))
            assertThrows(CodemError::class.java) { RuntimeLocator.resolveFromPlugin(root) }
        }
        for (name in listOf(RuntimeLocator.targets.getValue(RuntimeLocator.currentTargetId()).executableName, authName())) {
            writeBundle(root)
            Files.writeString(root.resolve("bin/app-server/$name"), "modified")
            assertThrows(CodemError::class.java) { RuntimeLocator.resolveFromPlugin(root) }
        }
    }

    @Test
    fun rejectsEscapingSymlinkAndMissingExecutePermission(@org.junit.jupiter.api.io.TempDir root: Path) {
        if (RuntimeLocator.currentTargetId().startsWith("win32-")) return
        writeBundle(root)
        val core = root.resolve("bin/app-server/codem-core")
        Files.setPosixFilePermissions(core, java.nio.file.attribute.PosixFilePermissions.fromString("rw-r--r--"))
        assertThrows(CodemError::class.java) { RuntimeLocator.resolveFromPlugin(root) }
        Files.move(core, root.resolve("outside"))
        Files.createSymbolicLink(core, root.resolve("outside"))
        assertThrows(CodemError::class.java) { RuntimeLocator.resolveFromPlugin(root) }
    }

    private fun authName(): String = if (RuntimeLocator.currentTargetId().startsWith("win32-")) "codem-auth.exe" else "codem-auth"

    private fun writeBundle(root: Path): JsonValue.ObjectValue {
        val target = RuntimeLocator.targets.getValue(RuntimeLocator.currentTargetId())
        val directory = Files.createDirectories(root.resolve("bin/app-server"))
        for (name in listOf(target.executableName, authName(), "LICENSE.core", "LICENSE.auth")) {
            val file = Files.writeString(directory.resolve(name), name)
            if (!target.id.startsWith("win32-")) file.toFile().setExecutable(true)
        }
        val manifest = JsonValue.obj(
            "schemaVersion" to JsonValue.NumberValue(2.0, "2"),
            "target" to JsonValue.Text(target.id),
            "packageName" to JsonValue.Text(target.packageName),
            "coreVersion" to JsonValue.Text(RuntimeLocator.CORE_VERSION),
            "executableName" to JsonValue.Text(target.executableName),
            "sha256" to JsonValue.Text(RuntimeLocator.sha256(directory.resolve(target.executableName))),
            "authPackageName" to JsonValue.Text(target.authPackageName),
            "cliVersion" to JsonValue.Text(RuntimeLocator.CLI_VERSION),
            "authExecutableName" to JsonValue.Text(authName()),
            "authSha256" to JsonValue.Text(RuntimeLocator.sha256(directory.resolve(authName()))),
        )
        writeManifest(root, manifest)
        return manifest
    }

    private fun writeManifest(root: Path, manifest: JsonValue.ObjectValue) {
        Files.writeString(root.resolve("bin/app-server/runtime.json"), encodeJson(manifest))
    }
}
