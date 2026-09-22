package com.codem.intellij.ide

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

class WorkspaceFileSearchTest {
    @Test
    fun matchesRelativePathsAndSkipsDependencyDirectories(@TempDir root: Path) {
        Files.createDirectories(root.resolve("src"))
        Files.writeString(root.resolve("src/App.kt"), "class App")
        Files.createDirectories(root.resolve("node_modules/pkg"))
        Files.writeString(root.resolve("node_modules/pkg/skip.kt"), "hidden")
        assertEquals(listOf("src/App.kt"), WorkspaceFileSearch.search(root, "app"))
        assertEquals(listOf("src/App.kt"), WorkspaceFileSearch.search(root, ""))
    }
}
