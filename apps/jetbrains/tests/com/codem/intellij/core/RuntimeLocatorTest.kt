package com.codem.intellij.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
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
    fun lockedLayoutResolvesWithoutPathOrNode(@org.junit.jupiter.api.io.TempDir root: Path) {
        val target = RuntimeLocator.targets.getValue(RuntimeLocator.currentTargetId())
        writeLockedLayout(root, target, RuntimeLocator.CORE_VERSION, RuntimeLocator.CLI_VERSION)
        Files.createFile(root.resolve("pnpm-lock.yaml"))
        val roots = RuntimeLocator.workspaceSearchRoots(root.resolve("apps").resolve("demo"))
        assertEquals(listOf(root.toAbsolutePath().normalize()), roots)
        val resolved = RuntimeLocator.resolveFromSearchRoots(roots)
        assertEquals(RuntimeLocator.CORE_VERSION, resolved.coreVersion)
        assertEquals(RuntimeLocator.CLI_VERSION, resolved.cliVersion)
        assertEquals(target.id, resolved.target.id)
        assertTrue(Files.isRegularFile(resolved.coreExecutable))
        assertTrue(Files.isRegularFile(resolved.authExecutable))
    }

    @Test
    fun lockedLayoutRejectsMismatchedVersions(@org.junit.jupiter.api.io.TempDir root: Path) {
        val target = RuntimeLocator.targets.getValue(RuntimeLocator.currentTargetId())
        writeLockedLayout(root, target, "0.8.37", RuntimeLocator.CLI_VERSION)
        var failed = false
        try {
            RuntimeLocator.resolveFromSearchRoots(listOf(root))
        } catch (error: CodemError) {
            failed = error.message?.contains("do not match locked") == true
        }
        assertTrue(failed)
    }

    @Test
    fun missingLockedLayoutDoesNotUsePath(@org.junit.jupiter.api.io.TempDir root: Path) {
        var failed = false
        try {
            RuntimeLocator.resolveFromSearchRoots(listOf(root))
        } catch (error: CodemError) {
            failed = error.message == "CodeM locked runtime is not bundled"
        }
        assertTrue(failed)
        assertTrue(RuntimeLocator.workspaceSearchRoots(root).isEmpty())
    }

    private fun writeLockedLayout(root: Path, target: RuntimeTarget, coreVersion: String, cliVersion: String) {
        val coreMeta = root.resolve("node_modules/@lark-codem/codem-core")
        val authMeta = root.resolve("node_modules/@lark-codem/codem-cli")
        val coreDir = root.resolve("node_modules/@lark-codem").resolve(target.packageName.substringAfterLast('/'))
        val authDir = root.resolve("node_modules/@lark-codem").resolve(target.authPackageName.substringAfterLast('/'))
        Files.createDirectories(coreMeta)
        Files.createDirectories(authMeta)
        Files.createDirectories(coreDir)
        Files.createDirectories(authDir.resolve(target.authExecutableName).parent)
        Files.writeString(coreMeta.resolve("package.json"), """{"version":"$coreVersion"}""")
        Files.writeString(authMeta.resolve("package.json"), """{"version":"$cliVersion"}""")
        Files.writeString(coreDir.resolve(target.executableName), "core")
        Files.writeString(authDir.resolve(target.authExecutableName), "auth")
        Files.writeString(coreDir.resolve("LICENSE"), "core-license")
        Files.writeString(authDir.resolve("LICENSE"), "auth-license")
    }
}
