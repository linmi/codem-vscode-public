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
    const val CORE_VERSION = "0.8.45"
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

    fun resolveFromBundle(bundleRoot: Path, expected: BundleManifest): ResolvedRuntime {
        val target = targets[currentTargetId()] ?: throw CodemError.Validation("unsupported runtime target")
        val listed = expected.targets[target.id] ?: throw CodemError.Validation("bundle manifest is missing ${target.id}")
        val core = requireFile(bundleRoot.resolve(listed.corePath), "core executable")
        val auth = requireFile(bundleRoot.resolve(listed.authPath), "authentication executable")
        val coreLicense = requireFile(bundleRoot.resolve(listed.coreLicensePath), "core license")
        val authLicense = requireFile(bundleRoot.resolve(listed.authLicensePath), "authentication license")
        val digest = sha256(core)
        if (digest != listed.coreSha256) {
            throw CodemError.Validation("CodeM core binary integrity failed for ${target.id}")
        }
        if (sha256(auth) != listed.authSha256) {
            throw CodemError.Validation("CodeM authentication binary integrity failed for ${target.id}")
        }
        if (expected.coreVersion != CORE_VERSION || expected.cliVersion != CLI_VERSION) {
            throw CodemError.Validation("CodeM bundle versions ${expected.coreVersion}/${expected.cliVersion} do not match locked $CORE_VERSION/$CLI_VERSION")
        }
        return ResolvedRuntime(target, expected.coreVersion, expected.cliVersion, core, auth, coreLicense, authLicense, digest)
    }

    /**
     * 从插件捆绑目录和仓库锁定布局解析运行时。
     * 不读 PATH，不调用 Node，不回退到未知版本。
     */
    fun workspaceSearchRoots(start: Path?): List<Path> {
        val roots = linkedSetOf<Path>()
        var current = start?.toAbsolutePath()?.normalize()
        while (current != null) {
            val appServer = current.resolve("packages/app-server")
            if (
                Files.isRegularFile(current.resolve("pnpm-lock.yaml")) ||
                Files.isDirectory(appServer) ||
                Files.isDirectory(current.resolve("node_modules/@lark-codem"))
            ) {
                roots.add(current)
                if (Files.isDirectory(appServer)) roots.add(appServer)
            }
            current = current.parent
        }
        return roots.toList()
    }

    fun pluginSearchRoots(pluginRoot: Path?, workspaceStart: Path?): List<Path> =
        listOfNotNull(pluginRoot?.toAbsolutePath()?.normalize()) + workspaceSearchRoots(workspaceStart)

    fun resolveFromSearchRoots(roots: List<Path>): ResolvedRuntime {
        val target = targets[currentTargetId()] ?: throw CodemError.Validation("unsupported runtime target")
        var versionMismatch: CodemError? = null
        for (root in roots) {
            val bundleManifest = root.resolve("runtime").resolve("manifest.json")
            if (Files.isRegularFile(bundleManifest)) {
                return resolveFromBundle(root.resolve("runtime"), BundleManifest.parse(JsonValue.parse(Files.readString(bundleManifest))))
            }
            try {
                val resolved = tryResolveLocked(root, target)
                if (resolved != null) return resolved
            } catch (error: CodemError) {
                if (error.errorClass == CodemError.Class.Validation && error.message?.contains("do not match locked") == true) {
                    versionMismatch = error
                    continue
                }
                throw error
            }
        }
        throw versionMismatch ?: CodemError.Validation("CodeM locked runtime is not bundled")
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

    private fun tryResolveLocked(root: Path, target: RuntimeTarget): ResolvedRuntime? {
        val coreMeta = findPackageDir(root, "@lark-codem/codem-core") ?: return null
        val authMeta = findPackageDir(root, "@lark-codem/codem-cli") ?: return null
        val coreVersion = readPackageVersion(coreMeta) ?: return null
        val cliVersion = readPackageVersion(authMeta) ?: return null
        if (coreVersion != CORE_VERSION || cliVersion != CLI_VERSION) {
            throw CodemError.Validation("CodeM package versions $coreVersion/$cliVersion do not match locked $CORE_VERSION/$CLI_VERSION")
        }
        val coreDir = siblingPackage(coreMeta, target.packageName) ?: findPackageDir(root, target.packageName) ?: return null
        val authDir = siblingPackage(authMeta, target.authPackageName) ?: findPackageDir(root, target.authPackageName) ?: return null
        val core = existingFile(coreDir.resolve(target.executableName)) ?: throw CodemError.Validation("CodeM App Server core executable is missing")
        val auth = existingFile(authDir.resolve(target.authExecutableName)) ?: throw CodemError.Validation("CodeM App Server authentication executable is missing")
        val coreLicense = existingFile(coreDir.resolve("LICENSE")) ?: throw CodemError.Validation("CodeM App Server core license is missing")
        val authLicense = existingFile(authDir.resolve("LICENSE")) ?: throw CodemError.Validation("CodeM App Server authentication license is missing")
        return ResolvedRuntime(target, coreVersion, cliVersion, core, auth, coreLicense, authLicense, sha256(core))
    }

    private fun findPackageDir(root: Path, packageName: String): Path? {
        val candidates = listOf(
            root.resolve("node_modules").resolve(packageName),
            root.resolve("packages/app-server/node_modules").resolve(packageName),
        )
        return candidates.firstOrNull { Files.isDirectory(it) }?.let { existing ->
            try {
                existing.toRealPath()
            } catch (_: Exception) {
                existing.toAbsolutePath().normalize()
            }
        }
    }

    private fun siblingPackage(metaPackage: Path, packageName: String): Path? {
        val name = packageName.substringAfterLast('/')
        val sibling = metaPackage.parent.resolve(name)
        return if (Files.isDirectory(sibling)) sibling else null
    }

    private fun readPackageVersion(packageDir: Path): String? {
        val manifest = packageDir.resolve("package.json")
        if (!Files.isRegularFile(manifest)) return null
        val parsed = try {
            JsonValue.parse(Files.readString(manifest)).asObject()
        } catch (_: Exception) {
            return null
        }
        return (parsed.fields["version"] as? JsonValue.Text)?.value?.takeIf { it.isNotBlank() }
    }

    private fun existingFile(path: Path): Path? =
        if (Files.isRegularFile(path)) path.toAbsolutePath() else null
}

data class BundleTarget(
    val corePath: String,
    val authPath: String,
    val coreLicensePath: String,
    val authLicensePath: String,
    val coreSha256: String,
    val authSha256: String,
)

data class BundleManifest(
    val schemaVersion: Int,
    val coreVersion: String,
    val cliVersion: String,
    val targets: Map<String, BundleTarget>,
) {
    companion object {
        fun parse(value: JsonValue): BundleManifest {
            val obj = value.asObject()
            val targets = linkedMapOf<String, BundleTarget>()
            val listed = obj.required("targets").asObject()
            for ((id, raw) in listed.fields) {
                val item = raw.asObject()
                targets[id] = BundleTarget(
                    corePath = item.required("corePath").asText(),
                    authPath = item.required("authPath").asText(),
                    coreLicensePath = item.required("coreLicensePath").asText(),
                    authLicensePath = item.required("authLicensePath").asText(),
                    coreSha256 = item.required("coreSha256").asText(),
                    authSha256 = item.required("authSha256").asText(),
                )
            }
            return BundleManifest(
                schemaVersion = (obj.required("schemaVersion") as JsonValue.NumberValue).value.toInt(),
                coreVersion = obj.required("coreVersion").asText(),
                cliVersion = obj.required("cliVersion").asText(),
                targets = targets,
            )
        }
    }
}
