package com.codem.intellij.session

import com.codem.intellij.core.CodemError
import com.codem.intellij.ide.AttachmentStore
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

class AttachmentCollectionTest {
    private val image = ImageAttachment("image/png", byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10))

    @Test
    fun removalNeverReusesIdentityOrDeletesOriginals(@TempDir root: Path) {
        val file = Files.writeString(root.resolve("original.txt"), "source")
        val collection = AttachmentCollection(object : AttachmentStore {
            override fun validate(path: Path, kind: AttachmentStore.Kind) = path
        })
        val first = collection.add(file, AttachmentStore.Kind.File)
        val second = collection.add(file, AttachmentStore.Kind.File)
        collection.remove(first)
        val third = collection.add(file, AttachmentStore.Kind.File)
        assertEquals(3, setOf(first, second, third).size)
        assertThrows(CodemError.Validation::class.java) { collection.retain(listOf(first), 1) }
        collection.clear()
        assertEquals("source", Files.readString(file))
    }

    @Test
    fun removedInFlightImageLivesUntilItsOwnConnectionReleasesIt() {
        val collection = AttachmentCollection(null)
        val id = collection.addImages(listOf(image)).single()
        val file = collection.retain(listOf(id), 1).single().path
        collection.consume(listOf(id))
        assertTrue(collection.visible().isEmpty())
        assertTrue(Files.exists(file))
        val next = collection.addImages(listOf(image)).single()
        val nextFile = collection.retain(listOf(next), 2).single().path
        collection.clear()
        collection.release(1)
        assertFalse(Files.exists(file))
        assertTrue(Files.exists(nextFile))
        collection.release(2)
        assertFalse(Files.exists(nextFile.parent))
    }

    @Test
    fun failedSendKeepsComposerAndRetryContent() {
        val collection = AttachmentCollection(null)
        val id = collection.addImages(listOf(image)).single()
        val file = collection.retain(listOf(id), 1).single().path
        collection.release(1)
        assertEquals(id, collection.visible().single().id)
        assertTrue(Files.exists(file))
        assertEquals(file, collection.retain(listOf(id), 2).single().path)
        collection.remove(id)
        collection.release(2)
        assertFalse(Files.exists(file.parent))
    }

    @Test
    fun pasteBatchRejectsInvalidContentWithoutPartialAttachments() {
        val collection = AttachmentCollection(null)
        assertThrows(CodemError.Validation::class.java) {
            collection.addImages(listOf(image, ImageAttachment("image/png", byteArrayOf(1))))
        }
        assertTrue(collection.visible().isEmpty())
        assertThrows(CodemError.Validation::class.java) { collection.addImages(List(21) { image }) }
        assertThrows(CodemError.Validation::class.java) { collection.addImages(listOf(ImageAttachment("image/png", ByteArray(20 * 1024 * 1024 + 1)))) }
        assertTrue(collection.visible().isEmpty())
    }

    @Test
    fun duplicateOrDisappearedInputIsRejectedBeforeUse(@TempDir root: Path) {
        val collection = AttachmentCollection(object : AttachmentStore {
            override fun validate(path: Path, kind: AttachmentStore.Kind) = path
        })
        val path = Files.createFile(root.resolve("gone.txt"))
        val id = collection.add(path, AttachmentStore.Kind.File)
        assertThrows(CodemError.Validation::class.java) { collection.retain(listOf(id, id), 1) }
        Files.delete(path)
        assertThrows(CodemError.Validation::class.java) { collection.retain(listOf(id), 1) }
    }
}
