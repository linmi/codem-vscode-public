package com.codem.intellij.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.FileTime
import java.util.concurrent.TimeUnit

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

    @Test
    fun oneVerifierHashesOnceForTheAccountRefreshAndConnect(@org.junit.jupiter.api.io.TempDir root: Path) {
        writeSettledBundle(root)
        val verifier = RuntimeVerifier(root)
        val account = verifier.verify()
        val connect = verifier.verify()
        assertEquals(2 to 0, account.hashed to account.reused)
        assertEquals(0 to 2, connect.hashed to connect.reused)
        assertEquals(account.runtime, connect.runtime)
        assertEquals(2, RuntimeVerifier(root).verify().hashed, "another verifier does not share digests")
    }

    @Test
    fun changedExecutableIsHashedAgain(@org.junit.jupiter.api.io.TempDir root: Path) {
        writeSettledBundle(root)
        val verifier = RuntimeVerifier(root)
        verifier.verify()
        Files.setLastModifiedTime(coreOf(root), FileTime.from(SETTLED_MTIME_SECONDS + 60, TimeUnit.SECONDS))
        val changed = verifier.verify()
        assertEquals(1 to 1, changed.hashed to changed.reused)
    }

    @Test
    fun tamperedExecutableIsRejectedAfterItsDigestWasReused(@org.junit.jupiter.api.io.TempDir root: Path) {
        writeSettledBundle(root)
        val verifier = RuntimeVerifier(root)
        verifier.verify()
        assertEquals(2, verifier.verify().reused)
        val core = coreOf(root)
        val mtime = Files.getLastModifiedTime(core)
        Files.writeString(core, Files.readString(core).reversed())
        // Same size and inode with the mtime restored: on POSIX only ctime differs. Windows NIO
        // reports no change time, so there the rewrite is detected through its new mtime instead.
        if (!RuntimeLocator.currentTargetId().startsWith("win32-")) Files.setLastModifiedTime(core, mtime)
        assertThrows(CodemError::class.java) { verifier.verify() }
        assertThrows(CodemError::class.java) { verifier.verify() }
    }

    @Test
    fun recentlyChangedExecutablesAreHashedOnEveryCall(@org.junit.jupiter.api.io.TempDir root: Path) {
        writeBundle(root)
        val verifier = RuntimeVerifier(root)
        assertEquals(listOf(2, 2), List(2) { verifier.verify().hashed })
    }

    private fun coreOf(root: Path): Path = root.resolve("bin/app-server/${RuntimeLocator.targets.getValue(RuntimeLocator.currentTargetId()).executableName}")

    /** Whole-second mtimes are restored exactly; waiting lets the last change leave the 2 s window. */
    private fun writeSettledBundle(root: Path) {
        writeBundle(root)
        for (path in listOf(coreOf(root), root.resolve("bin/app-server/${authName()}"))) {
            Files.setLastModifiedTime(path, FileTime.from(SETTLED_MTIME_SECONDS, TimeUnit.SECONDS))
        }
        Thread.sleep(2_100)
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

    private companion object {
        const val SETTLED_MTIME_SECONDS = 1_700_000_000L
    }
}
