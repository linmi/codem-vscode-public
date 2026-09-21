package com.codem.intellij.ide

import com.codem.intellij.core.CodemError
import java.nio.file.Files
import java.nio.file.Path

data class WorkspaceTrustFacts(
    val projectOpen: Boolean,
    val projectPath: Path?,
    val candidatePath: Path?,
    /** null 表示宿主没能给出信任结论；判不出不是信任。 */
    val ideReportsTrusted: Boolean?,
)

/**
 * 工作区信任的可测规则。IDEA 适配只负责采集事实，不得恒为真。
 * 无信任时拒绝启动 Core、发送轮次和读写项目文件。
 */
object WorkspaceTrustPolicy {
    const val START_CORE = "starting Core"
    const val SEND_TURN = "sending a turn"
    const val MUTATE_FILES = "reading or writing project files"
    const val CONTROL_THREAD = "changing the current thread"
    const val UNKNOWN_TRUST = "CodeM could not read this IDE's workspace trust state"

    fun decide(facts: WorkspaceTrustFacts): Boolean {
        if (!facts.projectOpen || facts.ideReportsTrusted != true) return false
        val root = facts.projectPath ?: return false
        val candidate = facts.candidatePath ?: return true
        return try {
            PathGuard.bind(root, candidate)
            true
        } catch (_: CodemError) {
            false
        }
    }

    fun requireTrusted(trusted: Boolean, operation: String) {
        if (!trusted) throw CodemError.Validation("CodeM requires a trusted project before $operation")
    }
}

data class SelectionSnapshot(
    val path: String,
    val startLine: Int,
    val endLine: Int,
    val text: String,
    val documentVersion: Long,
    val saved: Boolean,
)

data class DiffPreview(
    val id: String,
    val label: String,
    /** Core 报告的文件绝对路径，用于让宿主按真实文件类型着色。 */
    val path: String,
    val added: Int,
    val removed: Int,
    val kind: Kind,
) {
    enum class Kind { Complete, Partial, Binary, Missing }
}

/** Core hunks 还原出的前后文本。没有 hunks 就没有这个值，不得用文件名顶替。 */
data class DiffTexts(val before: String, val after: String)

interface WorkspaceTrust {
    fun isTrusted(path: Path): Boolean
}

interface SelectionReader {
    fun current(): SelectionSnapshot?
}

interface AttachmentStore {
    fun validate(path: Path, kind: Kind): Path
    enum class Kind { File, Directory, Image }
}

interface DiffPresenter {
    fun open(preview: DiffPreview, content: DiffTexts)
}

object NoopDiffPresenter : DiffPresenter {
    override fun open(preview: DiffPreview, content: DiffTexts) = Unit
}

class RecordingDiffPresenter : DiffPresenter {
    val opened = mutableListOf<Pair<DiffPreview, DiffTexts>>()
    override fun open(preview: DiffPreview, content: DiffTexts) {
        opened += preview to content
    }
}

/** A08 历史分页端口。无 IDEA 时测试注入假源。 */
fun interface HistorySource {
    fun read(cwd: String, threadId: String, cursor: String?): com.codem.intellij.history.HistoryPage
}

/** B08 额外目录由宿主选择，域层只收规范化路径。 */
fun interface DirectoryPicker {
    fun pick(): Path?
}

interface SecretVault {
    fun get(key: String): String?
    fun set(key: String, value: String)
    fun remove(key: String)
}

object PathGuard {
    /** 解析符号链接后再判断是否仍落在受信任根下，防止 link → 根外。 */
    fun bind(root: Path, candidate: Path): Path {
        val realRoot = realPathOrNormalized(root)
        val realCandidate = realPathOrNormalized(candidate)
        if (!realCandidate.startsWith(realRoot)) {
            throw CodemError.Validation("CodeM rejected a path outside the trusted project")
        }
        return realCandidate
    }

    fun realPathOrNormalized(path: Path): Path {
        val absolute = path.toAbsolutePath().normalize()
        val existing = generateSequence(absolute) { it.parent }.firstOrNull { Files.exists(it) } ?: absolute
        val realExisting = try {
            existing.toRealPath()
        } catch (_: Exception) {
            existing
        }
        if (existing == absolute) return realExisting
        return realExisting.resolve(existing.relativize(absolute)).normalize()
    }
}
