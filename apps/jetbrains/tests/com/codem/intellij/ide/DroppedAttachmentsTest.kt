package com.codem.intellij.ide

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue
import com.codem.intellij.webview.ViewAction
import com.codem.intellij.webview.parseViewAction
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

class DroppedAttachmentsTest {
    @Test
    fun workspaceFilesFoldersAndImagesAreAccepted(@TempDir temp: Path) {
        val root = Files.createDirectories(temp.resolve("work space"))
        val file = Files.writeString(root.resolve("Main.kt"), "fun main() {}")
        val image = Files.write(Files.createDirectories(root.resolve("img")).resolve("shot.PNG"), byteArrayOf(1))
        assertEquals(file.toRealPath() to AttachmentStore.Kind.File, DroppedAttachments.resolve(root, file.toUri().toString()))
        assertEquals(image.toRealPath() to AttachmentStore.Kind.Image, DroppedAttachments.resolve(root, image.toUri().toString()))
        assertEquals(root.resolve("img").toRealPath() to AttachmentStore.Kind.Directory, DroppedAttachments.resolve(root, root.resolve("img").toUri().toString()))
    }

    @Test
    fun anythingOutsideTheWorkspaceIsRefusedEvenThroughASymlink(@TempDir temp: Path) {
        val root = Files.createDirectories(temp.resolve("work"))
        val outside = Files.writeString(temp.resolve("secret.txt"), "x")
        val link = Files.createSymbolicLink(root.resolve("link.txt"), outside)
        for (uri in listOf(outside.toUri().toString(), link.toUri().toString(), "file://host/share/x", "file:///%zz")) {
            val error = assertThrows(CodemError.Validation::class.java, { DroppedAttachments.resolve(root, uri) }, uri)
            assertEquals(DroppedAttachments.OUTSIDE, error.message, uri)
        }
        assertThrows(CodemError.Validation::class.java) { DroppedAttachments.resolve(root, root.resolve("missing.kt").toUri().toString()) }
    }

    @Test
    fun theActionCarriesOnlyBoundedFileUris() {
        fun action(vararg uris: String) = JsonValue.obj(
            "type" to JsonValue.Text("dropAttachments"),
            "uris" to JsonValue.ArrayValue(uris.map { JsonValue.Text(it) }),
        )
        assertEquals(ViewAction.DropAttachments(listOf("file:///a/b.kt")), parseViewAction(action("file:///a/b.kt")))
        for (bad in listOf(action(), action("https://example.com/a"), action("file:///a\nb"), action("file:///" + "a".repeat(4096)), action(*Array(21) { "file:///$it" }))) {
            assertThrows(CodemError::class.java) { parseViewAction(bad) }
        }
        assertThrows(CodemError::class.java) {
            parseViewAction(JsonValue.obj("type" to JsonValue.Text("dropAttachments"), "uris" to JsonValue.ArrayValue(listOf(JsonValue.Text("file:///a"))), "extra" to JsonValue.Bool(true)))
        }
    }
}
