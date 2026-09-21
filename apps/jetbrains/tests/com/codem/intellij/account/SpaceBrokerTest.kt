package com.codem.intellij.account

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SpaceBrokerTest {
    @Test
    fun managedDirectoryAcceptsWindowsAndUnixAbsolutePaths() {
        assertTrue(isAbsoluteManagedDirectory("/tmp/managed"))
        assertTrue(isAbsoluteManagedDirectory("C:\\Users\\codem\\managed"))
        assertTrue(isAbsoluteManagedDirectory("D:/data/managed"))
        assertTrue(isAbsoluteManagedDirectory("\\\\server\\share\\managed"))
        assertEquals(false, isAbsoluteManagedDirectory("relative/path"))
        assertEquals(false, isAbsoluteManagedDirectory("C:relative"))
        assertEquals(false, isAbsoluteManagedDirectory("managed\u0000dir"))
    }

    @Test
    fun parsePreparedRejectsRelativeManagedDirectory() {
        val payload = JsonValue.obj(
            "project_key" to JsonValue.Text("proj_a"),
            "project_name" to JsonValue.Text("Space A"),
            "status" to JsonValue.Text("ok"),
            "managed_dir" to JsonValue.Text("relative/path"),
        )
        var failed = false
        try {
            parsePrepared(payload, "proj_a")
        } catch (error: CodemError) {
            failed = error.errorClass == CodemError.Class.Validation
        }
        assertTrue(failed)
        val windows = parsePrepared(
            JsonValue.obj(
                "project_key" to JsonValue.Text("proj_a"),
                "project_name" to JsonValue.Text("Space A"),
                "status" to JsonValue.Text("ok"),
                "managed_dir" to JsonValue.Text("C:\\Users\\codem\\space"),
            ),
            "proj_a",
        )
        assertEquals("C:\\Users\\codem\\space", windows.managedDirectory)
        val launched = object : SpaceGateway {
            override fun prepareInitial(requestedKey: String?) = throw UnsupportedOperationException()
            override fun prepare(projectKey: String) = windows
            override fun launchArguments(space: PreparedSpace) =
                listOf("--project-key", space.projectKey) to mapOf("CODEM_MANAGED_DIR" to space.managedDirectory!!)
        }.launchArguments(windows)
        assertEquals("C:\\Users\\codem\\space", launched.second["CODEM_MANAGED_DIR"])
    }
}
