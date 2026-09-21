package com.codem.intellij.ide

import com.codem.intellij.core.CodemError
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffManager
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import java.nio.file.Files
import java.nio.file.Path

/** 选区读取 Document 快照与版本。未保存内容不以磁盘内容冒充。 */
class IdeaSelectionReader(private val project: Project) : SelectionReader {
    override fun current(): SelectionSnapshot? = ReadAction.compute<SelectionSnapshot?, RuntimeException> {
        val editor = FileEditorManager.getInstance(project).selectedTextEditor ?: return@compute null
        val document = editor.document
        val file = FileDocumentManager.getInstance().getFile(document) ?: return@compute null
        val selection = editor.selectionModel
        val start = document.getLineNumber(selection.selectionStart) + 1
        val end = document.getLineNumber(selection.selectionEnd) + 1
        SelectionSnapshot(
            path = file.path,
            startLine = start,
            endLine = end,
            text = selection.selectedText ?: "",
            documentVersion = document.modificationStamp,
            saved = !FileDocumentManager.getInstance().isDocumentUnsaved(document),
        )
    }
}

class IdeaSecretVault(private val project: Project) : SecretVault {
    private fun attributes(key: String) =
        com.intellij.credentialStore.CredentialAttributes("codem.${project.locationHash}.$key")

    override fun get(key: String): String? =
        com.intellij.ide.passwordSafe.PasswordSafe.instance.getPassword(attributes(key))

    override fun set(key: String, value: String) {
        com.intellij.ide.passwordSafe.PasswordSafe.instance.setPassword(attributes(key), value)
    }

    override fun remove(key: String) {
        set(key, "")
    }
}

/**
 * IDEA 工作区信任适配。2026.2 的方法在 `trustedProjects.TrustedProjects.isProjectTrusted`，
 * 旧包名是 `impl.TrustedProjects.isTrusted`，两者都可能是 Kotlin object 的实例方法。
 *
 * 更改要点：静态与 object INSTANCE 两种调用都探测；全部探测失败时返回 null，
 * 由策略当作不信任，绝不把「读不到结论」当成已信任放行。
 */
class IdeaWorkspaceTrust(private val project: Project) : WorkspaceTrust {
    private val log = com.intellij.openapi.diagnostic.Logger.getInstance(IdeaWorkspaceTrust::class.java)

    override fun isTrusted(path: Path): Boolean {
        val root = project.basePath?.let { Path.of(it) }
        val reported = ideProjectTrusted(project)
        if (reported == null) log.warn(WorkspaceTrustPolicy.UNKNOWN_TRUST)
        return WorkspaceTrustPolicy.decide(
            WorkspaceTrustFacts(
                projectOpen = !project.isDisposed,
                projectPath = root,
                candidatePath = path,
                ideReportsTrusted = reported,
            ),
        )
    }

    /** null 表示这个 IDE 版本上没有任何已知信任 API 可调用。 */
    private fun ideProjectTrusted(project: Project): Boolean? {
        val classes = listOf(
            "com.intellij.ide.trustedProjects.TrustedProjects",
            "com.intellij.ide.impl.TrustedProjects",
        )
        val methods = listOf("isProjectTrusted", "isTrusted")
        for (className in classes) {
            val type = try {
                Class.forName(className)
            } catch (_: Throwable) {
                continue
            }
            val instance = try {
                type.getField("INSTANCE").get(null)
            } catch (_: Throwable) {
                null
            }
            for (name in methods) {
                val method = try {
                    type.getMethod(name, Project::class.java)
                } catch (_: Throwable) {
                    continue
                }
                for (receiver in listOf(null, instance)) {
                    try {
                        return method.invoke(receiver, project) as? Boolean ?: continue
                    } catch (_: Throwable) {
                    }
                }
            }
        }
        return null
    }
}

/** 附件只接受受信任项目内的文件或目录，标签只用文件名。 */
class IdeaAttachmentStore(private val project: Project) : AttachmentStore {
    override fun validate(path: Path, kind: AttachmentStore.Kind): Path {
        val root = project.basePath?.let { Path.of(it) } ?: throw CodemError.Validation("CodeM has no project directory")
        val bound = PathGuard.bind(root, path)
        when (kind) {
            AttachmentStore.Kind.Directory -> if (!Files.isDirectory(bound)) throw CodemError.Validation("CodeM attachment must be a directory")
            AttachmentStore.Kind.File, AttachmentStore.Kind.Image -> if (!Files.isRegularFile(bound)) throw CodemError.Validation("CodeM attachment must be a file")
        }
        return bound
    }
}

/**
 * A10：原生只读 Diff，两侧都是 Core hunks 还原的真实文本，按文件类型着色。
 *
 * 更改要点：不再把文件名当成「修改后内容」；partial 在标题里标明只含部分 hunk。
 */
class IdeaDiffPresenter(private val project: Project) : DiffPresenter {
    override fun open(preview: DiffPreview, content: DiffTexts) {
        val fileType = FileTypeManager.getInstance().getFileTypeByFileName(preview.path.substringAfterLast('/').substringAfterLast('\\'))
        val title = buildString {
            append(preview.label)
            append(" (+${preview.added} −${preview.removed})")
            if (preview.kind == DiffPreview.Kind.Partial) append(" · 仅部分片段")
        }
        val show = {
            val factory = DiffContentFactory.getInstance()
            val left = factory.create(project, content.before, fileType)
            val right = factory.create(project, content.after, fileType)
            DiffManager.getInstance().showDiff(
                project,
                SimpleDiffRequest(title, left, right, "Before", "After"),
            )
        }
        if (ApplicationManager.getApplication().isDispatchThread) show() else {
            ApplicationManager.getApplication().invokeLater(show)
        }
    }
}

fun revealFile(project: Project, file: VirtualFile) {
    FileEditorManager.getInstance(project).openFile(file, true)
}

fun writeCommand(project: Project, name: String, action: () -> Unit) {
    WriteCommandAction.runWriteCommandAction(project, name, "codem", action)
}

fun selectedEditor(project: Project): Editor? = FileEditorManager.getInstance(project).selectedTextEditor
