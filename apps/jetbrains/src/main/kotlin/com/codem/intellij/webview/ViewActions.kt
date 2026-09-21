package com.codem.intellij.webview

import com.codem.intellij.core.CodemError
import com.codem.intellij.core.JsonValue

/**
 * 与 @codem/ui contract.ts 共用的快照/动作形状。
 * 主机只下发快照与主题，不向界面暴露协议帧、密钥或任意文件路径。
 */
sealed class ViewAction {
    data object Ready : ViewAction()
    data object Connect : ViewAction()
    data object SignIn : ViewAction()
    data object SignOut : ViewAction()
    data object CancelSignIn : ViewAction()
    data object NewChat : ViewAction()
    data object Stop : ViewAction()
    data object RefreshAccount : ViewAction()
    data object RefreshSpaces : ViewAction()
    data object OlderMessages : ViewAction()
    data object RefreshBackground : ViewAction()
    data object CleanBackground : ViewAction()
    data object AddDirectory : ViewAction()
    data object CancelSideQuestion : ViewAction()
    data object PinSelection : ViewAction()
    data object ShowHistory : ViewAction()
    data class Send(
        val text: String,
        val requestId: String,
        val skillName: String? = null,
        val attachmentIds: List<String> = emptyList(),
        val selectionIds: List<String> = emptyList(),
    ) : ViewAction()
    data class PanelReply(val id: String, val choiceIds: List<String>, val text: String, val cancelled: Boolean) : ViewAction()
    data class ResumeThread(val threadId: String) : ViewAction()
    data class SetEffort(val effort: String) : ViewAction()
    data class SetWorkMode(val workMode: String) : ViewAction()
    data class SetPermission(val permission: String) : ViewAction()
    data class SetTheme(val theme: String) : ViewAction()
    data class PickAttachment(val kind: String) : ViewAction()
    data class ChooseModel(val id: String) : ViewAction()
    data class ChooseSpace(val id: String) : ViewAction()
    data class OpenDiff(val id: String) : ViewAction()
    data class TerminateBackground(val id: String) : ViewAction()
    data class CancelBackgroundTask(val id: String) : ViewAction()
    data class RemoveAttachment(val id: String) : ViewAction()
    data class RemoveDirectory(val id: String) : ViewAction()
    data class SelectSkill(val id: String?) : ViewAction()
    data class LoadCatalog(val kind: String) : ViewAction()
    data class ManageThread(val operation: String, val threadId: String, val name: String, val requestId: String) : ViewAction()
    data class Steer(val threadId: String, val text: String, val requestId: String) : ViewAction()
    data class AskSideQuestion(val threadId: String, val text: String, val requestId: String) : ViewAction()
    data class ShellCommand(val threadId: String, val text: String, val requestId: String) : ViewAction()
    data class CompactThread(val threadId: String, val requestId: String) : ViewAction()
    data class RewindThread(val threadId: String, val requestId: String) : ViewAction()
    data class ClearThread(val threadId: String, val requestId: String) : ViewAction()
}

data class ComposerChoiceView(val id: String, val label: String, val description: String, val selected: Boolean)
data class CatalogRowView(val label: String, val detail: String)
data class ComposerCatalogView(val models: List<ComposerChoiceView> = emptyList(), val spaces: List<ComposerChoiceView> = emptyList())
data class CatalogSnapshotView(val kind: String, val rows: List<CatalogRowView>, val loaded: Boolean = true)
data class DirectoryView(val id: String, val label: String)
data class UsageView(val input: Int?, val output: Int?, val cacheRead: Int?, val cacheWrite: Int?)
data class PlanItemView(val content: String, val status: String)
data class DiffView(val id: String, val label: String, val added: Int, val removed: Int, val preview: String, val available: Boolean)
data class AttachmentView(val id: String, val label: String, val kind: String)
data class SelectionView(val id: String, val label: String)
data class BackgroundView(val id: String, val label: String, val inProgress: Boolean)
data class SkillView(val id: String, val name: String, val description: String)
data class PanelChoiceView(val id: String, val label: String)
data class PendingPanelView(
    val id: String,
    val kind: String,
    val title: String,
    val description: String,
    val choices: List<PanelChoiceView>,
    val allowText: Boolean,
    val multiple: Boolean,
)
data class CapabilityView(
    val plan: List<PlanItemView> = emptyList(),
    val usage: UsageView? = null,
    val activity: String? = null,
    val changes: List<DiffView> = emptyList(),
    val threadStatus: String? = null,
)
data class SessionToolsView(
    val skills: List<SkillView> = emptyList(),
    val selectedSkill: String? = null,
    val catalog: CatalogSnapshotView? = null,
    val directories: List<DirectoryView> = emptyList(),
    val busy: String? = null,
)
data class ToolDetailsView(val kind: String, val fields: List<CatalogRowView> = emptyList(), val code: String? = null)
data class ChatMessageView(
    val id: String,
    val role: String,
    val text: String,
    val turnId: String? = null,
    val label: String? = null,
    val status: String? = null,
    val summary: String? = null,
    val hasArtifacts: Boolean = false,
    val details: ToolDetailsView? = null,
)
data class TurnTimingView(val turnId: String, val startedAt: Long, val finishedAt: Long? = null)
data class AccountProfileView(
    val displayName: String? = null,
    val userId: String? = null,
    val tenantId: String? = null,
    val authMethod: String? = null,
    val avatarKind: String = "none",
    val avatarUrl: String? = null,
)
data class AccountView(
    val status: String = "checking",
    val message: String? = null,
    val notice: String? = null,
    val progress: String? = null,
    val refreshing: Boolean = false,
    val profile: AccountProfileView? = null,
)
data class SlashCommandView(val id: String, val label: String, val group: String)

data class ChatSnapshot(
    val type: String = "state",
    val phase: String,
    val workspace: String?,
    val space: String?,
    val threadId: String?,
    val resumeThreadId: String? = null,
    val model: String?,
    val effort: String,
    val permission: String,
    val workMode: String,
    val modeRevision: Int? = null,
    val notice: String?,
    val version: Long,
    val theme: String = "light",
    val hasOlderMessages: Boolean,
    val historyNeedsRefresh: Boolean,
    val assistantText: String,
    val messages: List<ChatMessageView> = emptyList(),
    val turnTimings: List<TurnTimingView> = emptyList(),
    val account: AccountView = AccountView(),
    val accountOpen: Boolean = false,
    val brandMark: String? = null,
    val slashCommands: List<SlashCommandView> = emptyList(),
    val pendingInteraction: String?,
    val pendingPanel: PendingPanelView? = null,
    val canRetry: Boolean = false,
    val canResume: Boolean = false,
    val canLoadOlder: Boolean = false,
    val composerCatalog: ComposerCatalogView = ComposerCatalogView(),
    val capabilities: CapabilityView = CapabilityView(),
    val sessionTools: SessionToolsView = SessionToolsView(),
    val attachments: List<AttachmentView> = emptyList(),
    val selections: List<SelectionView> = emptyList(),
    val diffs: List<DiffView> = emptyList(),
    val background: List<BackgroundView> = emptyList(),
)

data class VisibleControls(val retry: Boolean, val resume: Boolean, val older: Boolean)

/** 挂载前的首屏：条件入口默认隐藏，不依赖首个 Host 响应。 */
fun initialSnapshot(): ChatSnapshot = ChatSnapshot(
    phase = "disconnected",
    workspace = null,
    space = null,
    threadId = null,
    resumeThreadId = null,
    model = null,
    effort = "medium",
    permission = "default",
    workMode = "default",
    modeRevision = null,
    notice = null,
    version = 0,
    hasOlderMessages = false,
    historyNeedsRefresh = false,
    assistantText = "",
    account = AccountView(status = "checking"),
    pendingInteraction = null,
    canRetry = false,
    canResume = false,
    canLoadOlder = false,
)

fun hiddenUntilReady(): List<String> = listOf("olderMessages", "retryConnect", "resumeThread")

/** A08：条件成立才显示，不再写死 resume/older = false。 */
fun visibleControls(snapshot: ChatSnapshot): VisibleControls = VisibleControls(
    retry = snapshot.phase == "failed" && snapshot.canRetry,
    resume = snapshot.canResume,
    older = snapshot.canLoadOlder,
)

fun parseViewAction(value: JsonValue): ViewAction {
    val obj = value.asObject()
    val type = obj.required("type").asText()
    val keys = obj.fields.keys
    return when (type) {
        "ready" -> if (keys.size == 1) ViewAction.Ready else reject()
        "connect" -> simple(keys, ViewAction.Connect)
        "signIn" -> simple(keys, ViewAction.SignIn)
        "signOut" -> simple(keys, ViewAction.SignOut)
        "cancelSignIn" -> simple(keys, ViewAction.CancelSignIn)
        "newChat" -> simple(keys, ViewAction.NewChat)
        "stop" -> simple(keys, ViewAction.Stop)
        "refreshAccount" -> simple(keys, ViewAction.RefreshAccount)
        "refreshSpaces" -> simple(keys, ViewAction.RefreshSpaces)
        "olderMessages" -> simple(keys, ViewAction.OlderMessages)
        "refreshBackground" -> simple(keys, ViewAction.RefreshBackground)
        "cleanBackground" -> simple(keys, ViewAction.CleanBackground)
        "addDirectory" -> simple(keys, ViewAction.AddDirectory)
        "cancelSideQuestion" -> simple(keys, ViewAction.CancelSideQuestion)
        "pinSelection" -> simple(keys, ViewAction.PinSelection)
        "showHistory" -> simple(keys, ViewAction.ShowHistory)
        "send" -> parseSend(obj)
        "panelReply" -> {
            val id = requestId(obj.required("id").asText())
            val choices = obj.required("choiceIds").asArray().items.map { handleId(it.asText()) }
            val text = obj.required("text").asText()
            val cancelled = obj.required("cancelled").asBoolean()
            if (text.length > 16_000) reject()
            if (cancelled && (choices.isNotEmpty() || text.isNotEmpty())) reject()
            ViewAction.PanelReply(id, choices, text, cancelled)
        }
        "resumeThread" -> ViewAction.ResumeThread(threadId(obj.required("threadId").asText()))
        "setEffort" -> ViewAction.SetEffort(effort(obj.required("effort").asText()))
        "setWorkMode" -> ViewAction.SetWorkMode(workMode(obj.required("workMode").asText()))
        "setPermission" -> ViewAction.SetPermission(permission(obj.required("permission").asText()))
        "setTheme" -> ViewAction.SetTheme(theme(obj.required("theme").asText()))
        "pickAttachment" -> {
            val kind = obj.required("kind").asText()
            if (kind != "file" && kind != "directory") reject()
            ViewAction.PickAttachment(kind)
        }
        "chooseModel" -> ViewAction.ChooseModel(handleId(obj.required("id").asText()))
        "chooseSpace" -> ViewAction.ChooseSpace(handleId(obj.required("id").asText()))
        "openDiff" -> ViewAction.OpenDiff(handleId(obj.required("id").asText()))
        "terminateBackground" -> ViewAction.TerminateBackground(handleId(obj.required("id").asText()))
        "cancelBackgroundTask" -> ViewAction.CancelBackgroundTask(handleId(obj.required("id").asText()))
        "removeAttachment" -> ViewAction.RemoveAttachment(handleId(obj.required("id").asText()))
        "removeDirectory" -> ViewAction.RemoveDirectory(handleId(obj.required("id").asText()))
        "selectSkill" -> ViewAction.SelectSkill(
            when (val id = obj.fields["id"]) {
                null, JsonValue.Null -> null
                is JsonValue.Text -> threadId(id.value)
                else -> reject()
            },
        )
        "loadCatalog" -> {
            val kind = obj.required("kind").asText()
            if (kind !in CATALOG_KINDS) reject()
            ViewAction.LoadCatalog(kind)
        }
        "manageThread" -> ViewAction.ManageThread(
            operation = obj.required("operation").asText().also { if (it !in THREAD_OPS) reject() },
            threadId = threadId(obj.required("threadId").asText()),
            name = obj.required("name").asText().also { if (it.length > 160) reject() },
            requestId = requestId(obj.required("requestId").asText()),
        )
        "steer" -> ViewAction.Steer(threadId(obj.required("threadId").asText()), nonEmpty(obj.required("text").asText()), requestId(obj.required("requestId").asText()))
        "askSideQuestion" -> ViewAction.AskSideQuestion(threadId(obj.required("threadId").asText()), nonEmpty(obj.required("text").asText()), requestId(obj.required("requestId").asText()))
        "shellCommand" -> ViewAction.ShellCommand(threadId(obj.required("threadId").asText()), nonEmpty(obj.required("text").asText()), requestId(obj.required("requestId").asText()))
        "compactThread" -> ViewAction.CompactThread(threadId(obj.required("threadId").asText()), requestId(obj.required("requestId").asText()))
        "rewindThread" -> ViewAction.RewindThread(threadId(obj.required("threadId").asText()), requestId(obj.required("requestId").asText()))
        "clearThread" -> ViewAction.ClearThread(threadId(obj.required("threadId").asText()), requestId(obj.required("requestId").asText()))
        else -> throw CodemError.Validation("Unsupported CodeM action $type")
    }
}

private val CATALOG_KINDS = setOf("skills", "environment", "config", "hooks", "plugins", "permissions", "spaces", "provider", "live", "tools")

/** 与 @codem/ui ChatSnapshot JSON 字段对齐，供预览和未来 JCEF 出站使用。 */
fun encodeChatSnapshot(snapshot: ChatSnapshot): JsonValue.ObjectValue {
    fun choice(item: ComposerChoiceView) = JsonValue.obj(
        "id" to JsonValue.Text(item.id),
        "label" to JsonValue.Text(item.label),
        "description" to JsonValue.Text(item.description),
        "selected" to JsonValue.Bool(item.selected),
    )
    fun nullableText(value: String?): JsonValue = value?.let { JsonValue.Text(it) } ?: JsonValue.Null
    fun nullableInt(value: Int?): JsonValue = value?.let { JsonValue.NumberValue(it.toDouble(), it.toString()) } ?: JsonValue.Null
    val usage = snapshot.capabilities.usage
    val panel = snapshot.pendingPanel
    val catalog = snapshot.sessionTools.catalog
    return JsonValue.obj(
        "type" to JsonValue.Text(snapshot.type),
        "phase" to JsonValue.Text(snapshot.phase),
        "workspace" to nullableText(snapshot.workspace),
        "space" to nullableText(snapshot.space),
        "threadId" to nullableText(snapshot.threadId),
        "resumeThreadId" to nullableText(snapshot.resumeThreadId),
        "model" to nullableText(snapshot.model),
        "effort" to JsonValue.Text(snapshot.effort),
        "permission" to JsonValue.Text(snapshot.permission),
        "workMode" to JsonValue.Text(snapshot.workMode),
        "modeRevision" to (snapshot.modeRevision?.let { JsonValue.NumberValue(it.toDouble(), it.toString()) } ?: JsonValue.Null),
        "notice" to nullableText(snapshot.notice),
        "version" to JsonValue.NumberValue(snapshot.version.toDouble(), snapshot.version.toString()),
        "theme" to JsonValue.Text(snapshot.theme),
        "hasOlderMessages" to JsonValue.Bool(snapshot.hasOlderMessages),
        "historyNeedsRefresh" to JsonValue.Bool(snapshot.historyNeedsRefresh),
        "assistantText" to JsonValue.Text(snapshot.assistantText),
        "messages" to JsonValue.ArrayValue(snapshot.messages.map { encodeMessage(it) }),
        "turnTimings" to JsonValue.ArrayValue(snapshot.turnTimings.map {
            JsonValue.obj(
                "turnId" to JsonValue.Text(it.turnId),
                "startedAt" to JsonValue.NumberValue(it.startedAt.toDouble(), it.startedAt.toString()),
                "finishedAt" to (it.finishedAt?.let { value -> JsonValue.NumberValue(value.toDouble(), value.toString()) } ?: JsonValue.Null),
            )
        }),
        "account" to encodeAccount(snapshot.account),
        "accountOpen" to JsonValue.Bool(snapshot.accountOpen),
        "brandMark" to nullableText(snapshot.brandMark),
        "slashCommands" to JsonValue.ArrayValue(snapshot.slashCommands.map {
            JsonValue.obj("id" to JsonValue.Text(it.id), "label" to JsonValue.Text(it.label), "group" to JsonValue.Text(it.group))
        }),
        "pendingInteraction" to nullableText(snapshot.pendingInteraction),
        "pendingPanel" to if (panel == null) JsonValue.Null else JsonValue.obj(
            "id" to JsonValue.Text(panel.id),
            "kind" to JsonValue.Text(panel.kind),
            "title" to JsonValue.Text(panel.title),
            "description" to JsonValue.Text(panel.description),
            "choices" to JsonValue.ArrayValue(panel.choices.map { JsonValue.obj("id" to JsonValue.Text(it.id), "label" to JsonValue.Text(it.label)) }),
            "allowText" to JsonValue.Bool(panel.allowText),
            "multiple" to JsonValue.Bool(panel.multiple),
        ),
        "canRetry" to JsonValue.Bool(snapshot.canRetry),
        "canResume" to JsonValue.Bool(snapshot.canResume),
        "canLoadOlder" to JsonValue.Bool(snapshot.canLoadOlder),
        "composerCatalog" to JsonValue.obj(
            "models" to JsonValue.ArrayValue(snapshot.composerCatalog.models.map(::choice)),
            "spaces" to JsonValue.ArrayValue(snapshot.composerCatalog.spaces.map(::choice)),
        ),
        "capabilities" to JsonValue.obj(
            "plan" to JsonValue.ArrayValue(snapshot.capabilities.plan.map { JsonValue.obj("content" to JsonValue.Text(it.content), "status" to JsonValue.Text(it.status)) }),
            "usage" to if (usage == null) JsonValue.Null else JsonValue.obj(
                "input" to nullableInt(usage.input),
                "output" to nullableInt(usage.output),
                "cacheRead" to nullableInt(usage.cacheRead),
                "cacheWrite" to nullableInt(usage.cacheWrite),
            ),
            "activity" to nullableText(snapshot.capabilities.activity),
            "changes" to JsonValue.ArrayValue(snapshot.capabilities.changes.map { JsonValue.obj("label" to JsonValue.Text(it.label), "added" to JsonValue.NumberValue(it.added.toDouble(), it.added.toString()), "removed" to JsonValue.NumberValue(it.removed.toDouble(), it.removed.toString())) }),
            "threadStatus" to nullableText(snapshot.capabilities.threadStatus),
        ),
        "sessionTools" to JsonValue.obj(
            "skills" to JsonValue.ArrayValue(snapshot.sessionTools.skills.map { JsonValue.obj("id" to JsonValue.Text(it.id), "name" to JsonValue.Text(it.name), "description" to JsonValue.Text(it.description)) }),
            "selectedSkill" to nullableText(snapshot.sessionTools.selectedSkill),
            "catalog" to if (catalog == null) JsonValue.Null else JsonValue.obj(
                "kind" to JsonValue.Text(catalog.kind),
                "rows" to JsonValue.ArrayValue(catalog.rows.map { JsonValue.obj("label" to JsonValue.Text(it.label), "detail" to JsonValue.Text(it.detail)) }),
                "loaded" to JsonValue.Bool(catalog.loaded),
            ),
            "directories" to JsonValue.ArrayValue(snapshot.sessionTools.directories.map { JsonValue.obj("id" to JsonValue.Text(it.id), "label" to JsonValue.Text(it.label)) }),
            "busy" to nullableText(snapshot.sessionTools.busy),
        ),
        "attachments" to JsonValue.ArrayValue(snapshot.attachments.map { JsonValue.obj("id" to JsonValue.Text(it.id), "label" to JsonValue.Text(it.label), "kind" to JsonValue.Text(it.kind)) }),
        "selections" to JsonValue.ArrayValue(snapshot.selections.map { JsonValue.obj("id" to JsonValue.Text(it.id), "label" to JsonValue.Text(it.label)) }),
        "diffs" to JsonValue.ArrayValue(snapshot.diffs.map { JsonValue.obj("id" to JsonValue.Text(it.id), "label" to JsonValue.Text(it.label), "added" to JsonValue.NumberValue(it.added.toDouble(), it.added.toString()), "removed" to JsonValue.NumberValue(it.removed.toDouble(), it.removed.toString()), "preview" to JsonValue.Text(it.preview), "available" to JsonValue.Bool(it.available)) }),
        "background" to JsonValue.ArrayValue(snapshot.background.map { JsonValue.obj("id" to JsonValue.Text(it.id), "label" to JsonValue.Text(it.label), "inProgress" to JsonValue.Bool(it.inProgress)) }),
    )
}

private fun encodeMessage(message: ChatMessageView): JsonValue.ObjectValue {
    val fields = mutableMapOf<String, JsonValue>(
        "id" to JsonValue.Text(message.id),
        "role" to JsonValue.Text(message.role),
        "text" to JsonValue.Text(message.text),
        "hasArtifacts" to JsonValue.Bool(message.hasArtifacts),
    )
    message.turnId?.let { fields["turnId"] = JsonValue.Text(it) }
    message.label?.let { fields["label"] = JsonValue.Text(it) }
    message.status?.let { fields["status"] = JsonValue.Text(it) }
    message.summary?.let { fields["summary"] = JsonValue.Text(it) }
    message.details?.let { details ->
        fields["details"] = JsonValue.obj(
            "kind" to JsonValue.Text(details.kind),
            "code" to (details.code?.let { JsonValue.Text(it) } ?: JsonValue.Null),
            "fields" to JsonValue.ArrayValue(details.fields.map { JsonValue.obj("label" to JsonValue.Text(it.label), "value" to JsonValue.Text(it.detail)) }),
        )
    }
    return JsonValue.ObjectValue(fields)
}

private fun encodeAccount(account: AccountView): JsonValue.ObjectValue {
    val fields = mutableMapOf<String, JsonValue>("status" to JsonValue.Text(account.status))
    account.message?.let { fields["message"] = JsonValue.Text(it) }
    account.notice?.let { fields["notice"] = JsonValue.Text(it) }
    account.progress?.let { fields["progress"] = JsonValue.Text(it) }
    if (account.status == "signedIn") fields["refreshing"] = JsonValue.Bool(account.refreshing)
    account.profile?.let { profile ->
        fields["profile"] = JsonValue.obj(
            "displayName" to (profile.displayName?.let { JsonValue.Text(it) } ?: JsonValue.Null),
            "userId" to (profile.userId?.let { JsonValue.Text(it) } ?: JsonValue.Null),
            "tenantId" to (profile.tenantId?.let { JsonValue.Text(it) } ?: JsonValue.Null),
            "authMethod" to (profile.authMethod?.let { JsonValue.Text(it) } ?: JsonValue.Null),
            "avatar" to when (profile.avatarKind) {
                "image" -> JsonValue.obj("kind" to JsonValue.Text("image"), "url" to JsonValue.Text(profile.avatarUrl ?: ""))
                "unavailable" -> JsonValue.obj("kind" to JsonValue.Text("unavailable"))
                else -> JsonValue.obj("kind" to JsonValue.Text("none"))
            },
        )
    }
    return JsonValue.ObjectValue(fields)
}

private val THREAD_OPS = setOf("rename", "fork", "archive", "unarchive", "delete")
private val REQUEST_ID = Regex("^[a-zA-Z0-9-]{1,100}$")
private val THREAD_ID = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
private val HANDLE = Regex("^[a-zA-Z0-9-]{1,100}$")

private fun parseSend(obj: JsonValue.ObjectValue): ViewAction.Send {
    val text = nonEmpty(obj.required("text").asText())
    val requestId = requestId(obj.required("requestId").asText())
    val skill = (obj.fields["skillName"] as? JsonValue.Text)?.value?.let { handleId(it) }
    val attachments = stringList(obj.fields["attachmentIds"])
    val selections = stringList(obj.fields["selectionIds"])
    if (skill != null && attachments.isNotEmpty()) reject()
    return ViewAction.Send(text, requestId, skill, attachments, selections)
}

private fun stringList(value: JsonValue?): List<String> {
    if (value == null) return emptyList()
    val items = value.asArray().items.map { handleId(it.asText()) }
    if (items.isEmpty() || items.size > 32 || items.toSet().size != items.size) reject()
    return items
}

private fun simple(keys: Set<String>, action: ViewAction): ViewAction =
    if (keys.size == 1) action else reject()

private fun requestId(value: String): String = value.takeIf { REQUEST_ID.matches(it) } ?: reject()
private fun threadId(value: String): String = value.takeIf { THREAD_ID.matches(it) } ?: reject()
private fun handleId(value: String): String = value.takeIf { HANDLE.matches(it) } ?: reject()
private fun nonEmpty(value: String): String = value.takeIf { it.trim().isNotEmpty() && it.length <= 32_000 } ?: reject()
private fun effort(value: String): String = value.takeIf { it in setOf("low", "medium", "high", "xhigh") } ?: reject()
private fun workMode(value: String): String = value.takeIf { it == "default" || it == "plan" } ?: reject()
private fun permission(value: String): String = value.takeIf { it in setOf("default", "auto", "yolo") } ?: reject()
private fun theme(value: String): String = value.takeIf { it == "light" || it == "dark" } ?: reject()
private fun reject(): Nothing = throw CodemError.Validation("Invalid CodeM action")
