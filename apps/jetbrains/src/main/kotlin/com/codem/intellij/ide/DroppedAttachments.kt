package com.codem.intellij.ide

import com.codem.intellij.core.CodemError
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path

/**
 * Files and folders dragged onto the chat arrive from the page as file: URIs and are untrusted. Like VS Code
 * droppedAttachment, only entries inside the connected workspace (by real path, so symlinks cannot lead out) are
 * accepted; anything else still goes through the attachment picker, where the person confirms it.
 */
object DroppedAttachments {
    const val MAX = 20
    private val IMAGE_EXTENSIONS = setOf("png", "jpg", "jpeg", "gif", "webp")

    fun resolve(root: Path, uri: String): Pair<Path, AttachmentStore.Kind> {
        val path = try {
            Path.of(URI(uri))
        } catch (_: Exception) {
            throw CodemError.Validation(OUTSIDE)
        }
        if (!Files.exists(path)) throw CodemError.Validation("CodeM 找不到拖入的文件，或无法读取。")
        val target = try {
            PathGuard.bind(root, path)
        } catch (_: CodemError.Validation) {
            throw CodemError.Validation(OUTSIDE)
        }
        if (Files.isDirectory(target)) return target to AttachmentStore.Kind.Directory
        if (!Files.isRegularFile(target)) throw CodemError.Validation("CodeM 只能拖入普通文件或文件夹。")
        val extension = target.fileName.toString().substringAfterLast('.', "").lowercase()
        return target to if (extension in IMAGE_EXTENSIONS) AttachmentStore.Kind.Image else AttachmentStore.Kind.File
    }

    const val OUTSIDE = "CodeM 只能拖入当前工作区里的文件或文件夹；其他位置请用“添加附件”选择。"
}
