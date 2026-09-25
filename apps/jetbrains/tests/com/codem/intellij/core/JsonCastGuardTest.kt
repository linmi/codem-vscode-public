package com.codem.intellij.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files
import java.nio.file.Path

/**
 * Production decoders read JSON through the typed accessors on [JsonValue.ObjectValue], so that missing, null and
 * mistyped fields are handled by one rule instead of a new `as? JsonValue.X` decision at each site. This guard scans
 * `src/main` and `src/plugin` (injected by Gradle as `codem.kotlinSources`, declared as test inputs) and fails on a
 * safe cast to a JsonValue type outside the files listed in [allowed].
 *
 * `is JsonValue.X` pattern matching stays allowed: it is how genuinely polymorphic code (the encoder, the RPC
 * envelope, catalog walks) branches on the sealed type.
 */
class JsonCastGuardTest {
    /** Files that may cast JsonValue themselves, each with the reason. Paths are relative to a source root. */
    private val allowed = mapOf(
        "com/codem/intellij/core/JsonValue.kt" to "the model itself: the typed accessors are implemented here",
    )

    @Test
    fun productionSourcesUseTypedAccessorsInsteadOfCasts() {
        val roots = sourceRoots()
        val present = mutableSetOf<String>()
        val violations = roots.flatMap { root ->
            Files.walk(root).use { paths ->
                paths.filter { Files.isRegularFile(it) && it.toString().endsWith(".kt") }.toList()
            }.flatMap { file ->
                val relative = root.relativize(file).toString().replace(File.separatorChar, '/')
                present += relative
                if (relative in allowed) emptyList() else JsonCastScanner.violations(relative, Files.readString(file))
            }
        }
        assertEquals(emptyList<String>(), violations, "Read these fields with JsonValue.ObjectValue accessors, or allow-list the file with a reason")
        assertEquals(emptySet<String>(), allowed.keys - present, "allow-list entries must name existing files")
    }

    @Test
    fun flagsSafeCastsToJsonValueTypes() {
        val source = """
            package sample

            import com.codem.intellij.core.JsonValue
            import com.codem.intellij.core.JsonValue.ObjectValue

            fun read(params: JsonValue.ObjectValue): String? {
                val text = (params.fields["a"] as? JsonValue.Text)?.value
                val nested = params.fields["b"] as?JsonValue . ArrayValue
                val imported = params.fields["c"] as? ObjectValue
                val packaged = params.fields["d"] as? com.codem.intellij.core.JsonValue.Bool
                return text ?: nested?.toString() ?: imported?.toString() ?: packaged?.toString()
            }
        """.trimIndent()
        assertEquals(listOf("Sample.kt:7", "Sample.kt:8", "Sample.kt:9", "Sample.kt:10"), JsonCastScanner.violations("Sample.kt", source))
    }

    @Test
    fun acceptsAccessorsPatternMatchingOtherCastsAndComments() {
        val source = """
            package sample

            import com.codem.intellij.core.CodemError
            import com.codem.intellij.core.JsonValue

            // Previously: (params.fields["a"] as? JsonValue.Text)?.value
            fun read(params: JsonValue.ObjectValue, error: Throwable, text: Any): String? {
                val failure = error as? CodemError
                val other = text as? Text
                /* a block comment may mention as? JsonValue.Bool too */
                return when (val value = params.optional("b")) {
                    is JsonValue.Text -> value.value
                    else -> params.stringOrNull("a") ?: failure?.message ?: other?.toString()
                }
            }
        """.trimIndent()
        assertEquals(emptyList<String>(), JsonCastScanner.violations("Sample.kt", source))
    }

    private fun sourceRoots(): List<Path> {
        val configured = System.getProperty("codem.kotlinSources")
            ?: error("codem.kotlinSources is not set; run the Kotlin tests through Gradle")
        return configured.split(File.pathSeparatorChar).map(Path::of).onEach {
            assertTrue(Files.isDirectory(it), "Kotlin source root is missing: $it")
        }
    }
}

/** Finds `as? JsonValue.X`, and `as? X` where X is imported from JsonValue, outside comments. */
private object JsonCastScanner {
    private val types = "Null|Bool|NumberValue|Text|ArrayValue|ObjectValue"
    private val qualified = Regex("""\bas\?\s*(?:\w+\s*\.\s*)*JsonValue\s*\.\s*($types)\b""")
    private val nestedImport = Regex("""^\s*import\s+com\.codem\.intellij\.core\.JsonValue\.($types|\*)\s*$""", RegexOption.MULTILINE)

    fun violations(name: String, source: String): List<String> {
        val imported = nestedImport.findAll(source).map { it.groupValues[1] }.toSet()
        val bareNames = if ("*" in imported) types else imported.joinToString("|")
        val bare = if (bareNames.isEmpty()) null else Regex("""\bas\?\s*($bareNames)\b""")
        var inBlockComment = false
        return source.lines().mapIndexedNotNull { index, line ->
            val (code, stillInComment) = stripComments(line, inBlockComment)
            inBlockComment = stillInComment
            val hit = qualified.containsMatchIn(code) || bare?.containsMatchIn(code) == true
            if (hit) "$name:${index + 1}" else null
        }
    }

    /** Removes `//` and `/* */` comments from one line; string literals containing them are not a concern here. */
    private fun stripComments(line: String, startsInComment: Boolean): Pair<String, Boolean> {
        val code = StringBuilder()
        var inComment = startsInComment
        var index = 0
        while (index < line.length) {
            if (inComment) {
                val end = line.indexOf("*/", index)
                if (end < 0) return code.toString() to true
                inComment = false
                index = end + 2
            } else if (line.startsWith("//", index)) {
                break
            } else if (line.startsWith("/*", index)) {
                inComment = true
                index += 2
            } else {
                code.append(line[index])
                index += 1
            }
        }
        return code.toString() to inComment
    }
}
