package com.codem.intellij.core

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.TimeUnit
import java.util.zip.ZipFile

/** Explicit native test. The normal check never executes bundled binaries or accesses an account. */
@Tag("nativeRuntime")
class NativeRuntimeTest {
    @Test
    fun extractedPluginRunsWithNoNodeOrRepository(@TempDir temporary: Path) {
        val root = Files.createDirectories(temporary.resolve("独立 plugin with spaces"))
        val zip = Path.of(System.getProperty("codem.pluginZip"))
        ZipFile(zip.toFile()).use { archive ->
            val names = archive.entries().asSequence().toList()
            assertFalse(names.any { it.name.contains("node_modules/") || it.name.contains("/tests/") })
            for (entry in names) {
                val output = root.resolve(entry.name).normalize()
                require(output.startsWith(root)) { "Plugin archive path escapes extraction directory" }
                if (entry.isDirectory) Files.createDirectories(output) else {
                    Files.createDirectories(output.parent)
                    archive.getInputStream(entry).use { Files.copy(it, output) }
                }
            }
        }
        val plugin = root.resolve("host")
        assertTrue(Files.isRegularFile(plugin.resolve("LICENSE")))
        ZipFile(plugin.resolve("lib/host-0.1.0.jar").toFile()).use { jar ->
            for (name in listOf("codem-ui/index.html", "codem-ui/browser.js", "codem-ui/styles.css", "META-INF/plugin.xml")) {
                assertNotNull(jar.getEntry(name), "Packaged plugin is missing $name")
            }
        }
        // java.util.zip does not restore Unix permissions; native installers do.
        val target = RuntimeLocator.targets.getValue(RuntimeLocator.currentTargetId())
        if (!target.id.startsWith("win32-")) {
            for (name in listOf(target.executableName, "codem-auth")) {
                assertTrue(plugin.resolve("bin/app-server/$name").toFile().setExecutable(true))
            }
        }
        val runtime = RuntimeLocator.resolveFromPlugin(plugin)
        val home = Files.createDirectories(temporary.resolve("empty home"))
        val emptyPath = Files.createDirectories(temporary.resolve("empty path"))
        val environment = mapOf(
            "HOME" to home.toString(), "USERPROFILE" to home.toString(),
            "CODEM_HOME" to home.toString(), "LINCO_HOME" to home.toString(),
            "LINCO_SESSIONS_ROOT" to home.resolve("sessions").toString(),
            "PATH" to emptyPath.toString(), "TMPDIR" to temporary.toString(),
        )
        fun launch(command: List<String>, cwd: Path): Process {
            val builder = ProcessBuilder(command).directory(cwd.toFile())
            builder.environment().clear()
            builder.environment().putAll(environment)
            return builder.start()
        }
        val auth = launch(listOf(runtime.authExecutable.toString(), "--version"), root)
        try {
            assertTrue(auth.waitFor(15, TimeUnit.SECONDS), "Authentication --version timed out")
            assertEquals(0, auth.exitValue(), auth.errorStream.bufferedReader().readText())
            assertTrue(auth.inputStream.bufferedReader().readText().contains(runtime.cliVersion))
        } finally {
            auth.destroyForcibly()
            assertTrue(auth.waitFor(5, TimeUnit.SECONDS))
        }
        val errors = ConcurrentLinkedQueue<CodemError>()
        val exited = CompletableFuture<ProcessExit>()
        var nativeProcess: Process? = null
        val core = CoreProcess(
            runtime, root,
            timeouts = Timeouts(initializeMs = 15_000),
            onNotification = {}, onRequest = { _, _ -> fail<Unit>("Handshake must not request interaction") },
            onProtocolError = { errors.add(it) }, onExit = { exited.complete(it) },
            processFactory = { command, cwd, _ ->
                val process = launch(command, cwd)
                nativeProcess = process
                JavaProcessAdapter(process)
            },
        )
        val started = System.nanoTime()
        try {
            core.start()
            assertEquals(1, core.initialization.protocolVersion)
            // Core reports SemVer build metadata; the pinned release remains exact.
            assertEquals(RuntimeLocator.CORE_VERSION, core.initialization.agentVersion.substringBefore('+'))
        } finally {
            if (nativeProcess != null) core.close().get(10, TimeUnit.SECONDS)
        }
        assertTrue(exited.get(5, TimeUnit.SECONDS).expected)
        assertFalse(nativeProcess!!.isAlive, "Core process leaked")
        assertTrue(errors.isEmpty(), errors.joinToString { it.message.orEmpty() })
        println("Packaged runtime verified: ${target.id}, Core ${runtime.coreVersion}, CLI ${runtime.cliVersion}, handshake+close ${(System.nanoTime() - started) / 1_000_000}ms, zip ${Files.size(zip)} bytes")
    }
}
