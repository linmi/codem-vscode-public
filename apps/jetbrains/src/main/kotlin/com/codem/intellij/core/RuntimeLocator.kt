package com.codem.intellij.core

import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest

data class RuntimeTarget(
    val id: String,
    val packageName: String,
    val executableName: String,
    val authPackageName: String,
    val authExecutableName: String,
)

data class ResolvedRuntime(
    val target: RuntimeTarget,
    val coreVersion: String,
    val cliVersion: String,
    val coreExecutable: Path,
    val authExecutable: Path,
    val coreLicense: Path,
    val authLicense: Path,
    val coreSha256: String,
)

/**
 * 运行包解析。完整性失败明确报错，不回退到 PATH 上的未知版本。
 * 版本只接受锁定事实来源，不默认 latest。
 */
object RuntimeLocator {
    const val CORE_VERSION = "0.8.47"
    const val CLI_VERSION = "0.1.208"

    val targets: Map<String, RuntimeTarget> = mapOf(
        "darwin-arm64" to RuntimeTarget("darwin-arm64", "@lark-codem/codem-core-darwin-arm64", "codem-core", "@lark-codem/codem-cli-darwin-arm64", "bin/codem"),
        "darwin-x64" to RuntimeTarget("darwin-x64", "@lark-codem/codem-core-darwin-x64", "codem-core", "@lark-codem/codem-cli-darwin-x64", "bin/codem"),
        "linux-arm64" to RuntimeTarget("linux-arm64", "@lark-codem/codem-core-linux-arm64-gnu", "codem-core", "@lark-codem/codem-cli-linux-arm64", "bin/codem"),
        "linux-x64" to RuntimeTarget("linux-x64", "@lark-codem/codem-core-linux-x64-gnu", "codem-core", "@lark-codem/codem-cli-linux-x64", "bin/codem"),
        "win32-arm64" to RuntimeTarget("win32-arm64", "@lark-codem/codem-core-win32-arm64-gnu", "codem-core.exe", "@lark-codem/codem-cli-win32-arm64", "bin/codem.exe"),
        "win32-x64" to RuntimeTarget("win32-x64", "@lark-codem/codem-core-win32-x64-msvc", "codem-core.exe", "@lark-codem/codem-cli-win32-x64", "bin/codem.exe"),
    )

    fun currentTargetId(osName: String = System.getProperty("os.name"), arch: String = System.getProperty("os.arch")): String {
        val os = osName.lowercase()
        val normalizedArch = when (arch.lowercase()) {
            "aarch64", "arm64" -> "arm64"
            "x86_64", "amd64" -> "x64"
            else -> arch.lowercase()
        }
        val platform = when {
            os.contains("mac") || os.contains("darwin") -> "darwin"
            os.contains("win") -> "win32"
            os.contains("nux") || os.contains("nix") -> "linux"
            else -> throw CodemError.Validation("CodeM App Server does not support $osName-$arch")
        }
        val id = "$platform-$normalizedArch"
        if (id !in targets) throw CodemError.Validation("CodeM App Server does not support $id")
        return id
    }

    /** Only the installed plugin owns its runtime; project files cannot select executables. Hashes both executables. */
    fun resolveFromPlugin(pluginRoot: Path): ResolvedRuntime = verifyPlugin(pluginRoot, null).runtime

    /** Validates the bundle on every call; [digests] only skips re-reading an unchanged executable. */
    internal fun verifyPlugin(pluginRoot: Path, digests: FileDigests?): RuntimeVerification {
        val bundleRoot = pluginRoot.resolve("bin/app-server")
        val manifestPath = requireFile(bundleRoot.resolve("runtime.json"), "bundle manifest")
        val manifest = JsonValue.parse(Files.readString(manifestPath)).asObject()
        val target = targets.getValue(currentTargetId())
        if (manifest.numberOrNull("schemaVersion") != 2.0) throw CodemError.Validation("CodeM runtime bundle requires schemaVersion 2")
        fun expect(field: String, expected: String): String {
            val actual = manifest.required(field).asText()
            if (actual != expected) throw CodemError.Validation("CodeM runtime $field is $actual; expected $expected")
            return actual
        }
        expect("target", target.id)
        expect("coreVersion", CORE_VERSION)
        expect("cliVersion", CLI_VERSION)
        expect("packageName", target.packageName)
        expect("authPackageName", target.authPackageName)
        val coreName = expect("executableName", target.executableName)
        val authName = expect("authExecutableName", if (target.id.startsWith("win32-")) "codem-auth.exe" else "codem-auth")
        val core = requireBundledFile(bundleRoot, coreName)
        val auth = requireBundledFile(bundleRoot, authName)
        val coreLicense = requireBundledFile(bundleRoot, "LICENSE.core")
        val authLicense = requireBundledFile(bundleRoot, "LICENSE.auth")
        if (!target.id.startsWith("win32-")) {
            for (path in listOf(core, auth)) {
                if (!Files.isExecutable(path)) throw CodemError.Validation("CodeM runtime executable permission is missing: ${path.fileName}")
            }
        }
        var reused = 0
        fun verifyDigest(field: String, path: Path): String {
            val expected = manifest.required(field).asText()
            if (!Regex("[a-f0-9]{64}").matches(expected)) throw CodemError.Validation("CodeM runtime $field is not a SHA-256 digest")
            val (actual, fromMemo) = digests?.sha256(path) ?: (sha256(path) to false)
            if (fromMemo) reused++
            if (actual != expected) throw CodemError.Validation("CodeM runtime $field integrity failed: ${path.fileName}")
            return actual
        }
        val coreDigest = verifyDigest("sha256", core)
        verifyDigest("authSha256", auth)
        val runtime = ResolvedRuntime(target, CORE_VERSION, CLI_VERSION, core, auth, coreLicense, authLicense, coreDigest)
        return RuntimeVerification(runtime, hashed = 2 - reused, reused = reused)
    }

    private fun requireBundledFile(root: Path, name: String): Path {
        val file = requireFile(root.resolve(name), name).toRealPath()
        if (file.parent != root.toRealPath()) throw CodemError.Validation("CodeM runtime file escapes bundle: $name")
        return file
    }

    fun sha256(path: Path): String {
        val digest = MessageDigest.getInstance("SHA-256")
        Files.newInputStream(path).use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
    }

    private fun requireFile(path: Path, label: String): Path {
        if (!Files.isRegularFile(path)) throw CodemError.Validation("CodeM App Server $label is missing: $path")
        return path.toAbsolutePath()
    }

}
