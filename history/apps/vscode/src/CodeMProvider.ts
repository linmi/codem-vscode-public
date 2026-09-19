import { DEFAULT_PROMPT_SETTINGS, type PromptDefaults } from "./shared/prompt-defaults"
import * as path from "path"
import * as vscode from "vscode"
import type { Session, SessionStatus } from "@codem/ui/types/session"
import type { KiloClient, ProviderUsage, Event, TextPartInput, FilePartInput } from "./services/cli-backend/leftover-sdk"
import { MaxCostNudge, type MaxCostChoice } from "./shared/max-cost-nudge"
import { type KiloConnectionService, ServerStartupError } from "./services/cli-backend"
import { previewSound, testOSNotification } from "./services/attention"
import type { EditorContext } from "./services/cli-backend/types"
import { FileIgnoreController } from "./services/autocomplete/shims/FileIgnoreController"
import { ChatTextAreaAutocomplete } from "./services/autocomplete/chat-autocomplete/ChatTextAreaAutocomplete"
import { notebookUri } from "./services/autocomplete/continuedev/core/autocomplete/notebook"
import { buildWebviewHtml, getWebviewFontSize, isCursorHost } from "./utils"
import { saveImage } from "./host/save-image"
import { handleEditorAction } from "./host/editor-actions"
import { exportTranscript } from "./host/export-transcript"
import {
  sessionToWebview,
  indexProvidersById,
  mapSSEEventToWebviewMessage,
  getErrorMessage,
  isEventFromForeignProject,
  MessageConfirmation,
  runWithMessageConfirmation,
  loadSessions as loadSessionsUtil,
  flushPendingSessionRefresh as flushPendingSessionRefreshUtil,
  resolveContextDirectory,
  resolveNewSessionDirectory,
  resolveWorkspaceDirectory,
  sameDirectory,
  SessionStreamScheduler,
  buildSettingPath,
  type SessionRefreshContext,
} from "./host/utils"
import { GitOps } from "./agent-manager/GitOps"
import { GitStatsPoller, type LocalStats } from "./agent-manager/GitStatsPoller"
import type { RemoteStatusService } from "./services/RemoteStatusService"
import { resolveProjectDirectory } from "./project-directory"
import { seedSessionStatuses } from "./session-status"
import { normalizeEnhancePromptErrorMessage } from "./enhance-prompt-error"
import { retry } from "./services/cli-backend/retry"
import { normalize, type SSEPayload, type SyncPayload, type WirePayload } from "./services/cli-backend/sdk-sse-adapter"
import { slimInfo, slimPart, slimParts } from "./host/slim-metadata"
import { handleSidebarWorktreeMessage } from "./host/sidebar-worktree"
import { parseMessageFiles, type MessageFile } from "./host/message-files"
import { renameSession } from "./host/rename-session"
import { handleFileSearch } from "./host/file-search"
import { handleSessionSearch } from "./host/session-search"
import { handleFilePicker } from "./host/file-picker"
import { watchFontSizeConfig } from "./host/font-size"
import { getTerminalContents } from "./services/terminal/context"
import { disposeGitChangesTarget } from "./host/git-changes-target"
import { interceptMessage } from "./host/git-changes-request"
import { matchFollowup, recordFollowup, type Followup } from "./host/followup-session"
import { fetchMessagePage, MESSAGE_PAGE_LIMIT } from "./host/message-page"
import { editPaths } from "./host/session-edits"
import {
  dismissNotification,
  fetchAndSendNotifications as fetchNotifications,
  resetReadNotifications,
  type NotificationsContext,
  type NotificationsMessage,
} from "./host/notifications"
import { childID } from "./host/task-session"
import { VisibleTaskStreams } from "./host/visible-task-streams"
import { handleNetworkEvent, clearNetworkWaits } from "./host/network"
import { SessionAbort } from "./host/abort"
import {
  buildAutocompleteSettingsMessage,
  validAutocompleteSetting,
  watchAutocompleteConfig,
} from "./services/autocomplete/settings"
import { routeEarlyMessage } from "./host/early-message"
import * as Board from "./host/session-board"
import * as ModelState from "./host/model-state"
import { handleModelUsageMessage } from "./host/model-usage"
import { handleForkSession } from "./host/fork-session"
import { openConfig } from "./host/open-config"
import {
  getWorkStylePayload,
  handleWorkStyleMessage,
  isWorkStyleSetting,
  watchWorkStyleConfig,
} from "./host/work-style"
import { retryable, backoff, MAX_RETRIES } from "./util/retry"
import { hasGit } from "./host/git-status"
import { handleSetOrganization, type AuthContext } from "./host/handlers/auth"
import { codeMWebviewProfile } from "./services/app-server/authentication-ui"
import { MatureUiAppServerController } from "./services/app-server/mature-ui-controller"
import { prepareMatureUiPrompt } from "./services/app-server/mature-ui-prompt"
import {
  CODEM_UI_INTERACTION_OWNERS,
  isAppServerOwned,
  type CodeMUiInteractionType,
  unmigratedAppServerCommandMessage,
} from "./services/app-server/ui-parity"
import {
  handleRequestCloudSessions,
  handleRequestCloudSessionData,
  handleImportAndSend,
  type CloudSessionContext,
} from "./host/handlers/cloud-session"
import {
  handlePermissionResponse,
  fetchAndSendPendingPermissions,
  type PermissionContext,
} from "./host/handlers/permission-handler"
import {
  handleQuestionReply,
  handleQuestionReject,
  fetchAndSendPendingQuestions,
} from "./host/handlers/question"
import { nativeTitle } from "./host/native-tab-title"
import { isActivity, type Activity } from "../webview-ui/src/utils/session-activity"
import type { PRReviewCommentData, ReviewMessageData } from "./shared/review-comments"
import { feedbackMetadata, parseFeedback, type BrowserFeedbackData } from "./shared/browser-feedback"
import { completesWithoutStatus, goalControl } from "./host/command-completion"
import {
  computeDefaultSelection,
  fetchProviderData,
  validateRecents,
  validateFavorites,
} from "./provider-actions"
import { AnacondaDesktopBridge } from "./anaconda-desktop/bridge"
import type { CodeMProviderOptions } from "./host/options"
import type { ProjectRef, SessionRef, WorktreeRef } from "./agent-manager/project/route"
import { stopSessionProcesses } from "./host/background-process"
import { sandboxSessionMetadata } from "./shared/sandbox-session"
import { canonicalizePath } from "./agent-manager/project/paths"
import { buildTimelineSettingMessage, validChatSetting, watchChatConfig } from "./host/chat-settings"
import { buildThroughputSettingMessage, watchThroughputConfig } from "./host/throughput-settings"
import {
  buildAutoApprovalReasonSettingMessage,
  watchAutoApprovalReasonConfig,
} from "./host/auto-approval-reason-settings"
import { buildPushFixesSettingMessage, pushFixes, watchPushFixesConfig } from "./host/push-fixes-settings"

type ReviewCommentsHandler = (comments: unknown[], autoSend: boolean, sessionID?: string, directory?: string) => void

let maxCost = 0

type MessageLoadMode = "replace" | "prepend" | "focus" | "reconcile"
type ContextMessage = { contextDirectory?: unknown }
type TypedWebviewMessage = {
  type: string
  value?: unknown
}

type WebviewMessage = Parameters<Parameters<vscode.Webview["onDidReceiveMessage"]>[0]>[0]

function feedbackMessage(message: { text: string; review?: unknown; browserFeedback?: unknown }) {
  return parseFeedback({ review: message.review, browserFeedback: message.browserFeedback }, message.text)
}

type SendWebviewMessage = {
  type: "sendMessage"
  text: string
  messageID?: unknown
  sessionID?: string
  draftID?: unknown
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
  files?: unknown
  review?: unknown
  browserFeedback?: unknown
  agentManagerContext?: unknown
  contextDirectory?: unknown
}
// message.part.* events are always session-scoped; drop them when the session is unknown.
const SESSION_SCOPED_PART_EVENTS = new Set(["message.part.updated", "message.part.delta", "message.part.removed"])
const isSessionScopedPartEvent = (type: string) => SESSION_SCOPED_PART_EVENTS.has(type)

type RawSyncPayload = Extract<WirePayload, { type: "sync" }>
type LegacySyncEvent =
  | {
      id: string
      type: "message.updated"
      properties: Extract<SyncPayload, { name: "message.updated.1" }>["data"]
    }
  | {
      id: string
      type: "message.removed"
      properties: Extract<SyncPayload, { name: "message.removed.1" }>["data"]
    }
  | {
      id: string
      type: "message.part.updated"
      properties: Extract<SyncPayload, { name: "message.part.updated.1" }>["data"]
    }
  | {
      id: string
      type: "message.part.removed"
      properties: Extract<SyncPayload, { name: "message.part.removed.1" }>["data"]
    }
  | {
      id: string
      type: "session.created"
      properties: Extract<SyncPayload, { name: "session.created.1" }>["data"]
    }
  | {
      source: "sync"
      id: string
      seq: number
      type: "session.updated"
      properties: Extract<SyncPayload, { name: "session.updated.1" }>["data"]
    }
  | {
      id: string
      type: "session.deleted"
      properties: Extract<SyncPayload, { name: "session.deleted.1" }>["data"]
    }

type ProviderEvent = Event | LegacySyncEvent

function isLegacySyncEvent(event: ProviderEvent): event is LegacySyncEvent {
  if (event.type === "session.updated") return "source" in event && event.source === "sync"
  return (
    event.type === "message.updated" ||
    event.type === "message.removed" ||
    event.type === "message.part.updated" ||
    event.type === "message.part.removed" ||
    event.type === "session.created" ||
    event.type === "session.deleted"
  )
}

export function unwrapSyncEvent(event: SSEPayload | RawSyncPayload): ProviderEvent | undefined {
  if (event.type !== "sync") return event
  const payload = "syncEvent" in event ? normalize(event) : event

  switch (payload.name) {
    case "message.updated.1":
      return { id: payload.id, type: "message.updated", properties: payload.data }
    case "message.removed.1":
      return { id: payload.id, type: "message.removed", properties: payload.data }
    case "message.part.updated.1":
      return { id: payload.id, type: "message.part.updated", properties: payload.data }
    case "message.part.removed.1":
      return { id: payload.id, type: "message.part.removed", properties: payload.data }
    case "session.created.1":
      return { id: payload.id, type: "session.created", properties: payload.data }
    case "session.updated.1":
      return { source: "sync", id: payload.id, seq: payload.seq, type: "session.updated", properties: payload.data }
    case "session.deleted.1":
      return { id: payload.id, type: "session.deleted", properties: payload.data }
    default:
      return undefined
  }
}

type ContextRequestMessage =
  | { type: "requestFileSearch"; query: string; requestId: string; sessionID?: string }
  | { type: "requestSessionSearch"; requestId: string; sessionID?: string }
  | { type: "requestFilePicker"; requestId: string }
  | { type: "requestTerminalContext"; requestId: string; sessionID?: string; agentManagerContext?: string }

/** VS Code host/webview coordinator. App Server commands go through the mature UI controller first. */
export class CodeMProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "codem.SidebarProvider"
  private readonly instanceId = crypto.randomUUID()

  private webview: vscode.Webview | null = null
  private currentSession: Session | null = null
  /** Remembers the last selected session so /new can stay in the same worktree after clearSession. */
  private contextSessionID: string | undefined
  private connectionState: "connecting" | "connected" | "disconnected" | "error" = "connecting"
  private connectionGeneration = 0
  private loginAttempt = 0
  private isWebviewReady = false
  private readonly extensionVersion = vscode.extensions.getExtension("codem.codem")?.packageJSON?.version ?? "unknown"
  private cachedProvidersMessage: unknown = null
  /** Coalesce provider refreshes — at most one follow-up rerun when a request lands mid-flight. */
  private providersRefresh: Promise<void> | null = null
  private providersQueued = false
  private providersGeneration = 0
  private sandboxRevision = 0
  /** Cached skillsLoaded payload so requestSkills can be served before client is ready */
  private cachedSkillsMessage: unknown = null
  private configWarningsShown = false
  /** Cached notificationsLoaded payload */
  private cachedNotificationsMessage: NotificationsMessage | null = null
  /** Cached provider usage payload for profile view remounts and temporary disconnects. */
  private cachedProviderUsageMessage: { type: "providerUsageLoaded"; data: ProviderUsage } | null = null
  private providerUsageGeneration = 0
  private pendingKiloModel: { modelID?: string; agent?: string } | null = null
  private pendingReviewComments: { comments: unknown[]; autoSend: boolean; sessionID?: string }[] = []
  private reviewCommentsHandler: ReviewCommentsHandler | undefined
  private readyResolvers: (() => void)[] = []
  private promptRecoveryQueued = false
  private promptRecovery: Promise<void> | null = null
  private trackedSessionIds: Set<string> = new Set()
  private readonly removedSessionIds = new Set<string>()
  private readonly openSessionIds = new Set<string>()
  private modelUsageSessionIds: Set<string> = new Set()
  private syncedChildSessions: Set<string> = new Set()
  private readonly inspectorSessionIds = new Set<string>()
  private readonly checkpoints = new Map<string, Promise<void>>()
  private readonly sessionCreations = new Map<string, Promise<{ sid: string; dir: string } | undefined>>()
  private readonly draftSessions = new Map<string, { sid: string; dir: string; expires: number }>()
  private readonly revisions = new Map<string, { id: string; seq: number }>()
  private readonly refreshes = new Map<string, number>()
  private readonly anacondaDesktop = new AnacondaDesktopBridge()
  private sessionStatusMap = new Map<string, SessionStatus["type"]>() // Latest status used for destructive config warnings.
  private activity: Activity = "idle"
  private active = false
  private caption: string | undefined
  private readonly epochs = new Map<string, Map<string, number>>()
  private readonly requests = new Map<string, number>()
  private epoch = 0
  private sessionDirectories = new Map<string, string>() // Per-session directory overrides, such as Agent Manager worktrees.
  private readonly owners = new Map<string, { dir: string; project: string }>()
  private sessionGitDirectories = new Map<string, string>() // Stable Git root resolved for each session.
  private sessionGitRecoveries = new Set<string>() // Sessions whose older history was scanned for a Git root.
  private readonly aborts = new SessionAbort()
  private projectID: string | undefined // Current workspace project ID used to filter sessions.
  private loadMessagesAbort: AbortController | null = null // Current load request cancellation.
  private lastReconciledAt = new Map<string, number>() // Per-session focus-mode reconcile timestamp.
  private pendingSessionRefresh = false // Refresh requested before the client is ready.
  private readonly streams = new SessionStreamScheduler((msg) => this.postMessage(msg))
  private readonly visibleTaskStreams = new VisibleTaskStreams((id, visible) => this.streams.setVisible(id, visible))
  private readonly confirmations = new MessageConfirmation()
  private readonly costs = new MaxCostNudge()
  private readonly activeAlerts = new Map<string, number>() // sid -> limit currently shown in UI
  private unsubscribeEvent: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private unsubscribeNotificationDismiss: (() => void) | null = null
  private unsubscribeAcknowledged: (() => void) | null = null
  private unsubscribeLanguageChange: (() => void) | null = null
  private codeMAuthenticationChange: vscode.Disposable | null = null
  private readonly appServerController: MatureUiAppServerController | null
  private readonly appServerEvent: vscode.Disposable | null
  private unsubscribeFavoritesChange: (() => void) | null = null
  private unsubscribeClearPendingPrompts: (() => void) | null = null
  private unsubscribeDirectoryProvider: (() => void) | null = null
  private initConnectionPromise: Promise<void> | null = null
  private webviewMessageDisposable: vscode.Disposable | null = null
  private autocompleteConfigDisposable: vscode.Disposable | null = null
  private chatConfigDisposable: vscode.Disposable | null = null
  private throughputConfigDisposable: vscode.Disposable | null = null
  private autoApprovalReasonConfigDisposable: vscode.Disposable | null = null
  private pushFixesConfigDisposable: vscode.Disposable | null = null
  private viewStateDisposable: vscode.Disposable | null = null
  private visibilityDisposable: vscode.Disposable | null = null

  private ignoreController: FileIgnoreController | null = null
  private ignoreControllerDir: string | null = null
  private chatAutocomplete: ChatTextAreaAutocomplete | null = null
  private projectDirectory: string | null | undefined
  private settingsGeneration = 0
  private slimEditMetadata = true

  private pendingFollowup: Followup | null = null
  private followupListeners: Array<(session: Session, directory: string) => void> = []
  private statsPoller: GitStatsPoller | null = null
  private statsGitOps: GitOps | null = null
  private statsVisible = true
  private cachedStats: unknown = null
  private cachedGitRepo = false
  private cachedGitDirectory: string | undefined
  private gitStatusRevision = 0
  private sessionRefreshRevision = 0

  private onBeforeMessage: ((msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>) | null = null

  private continueInWorktreeHandler:
    | ((sessionId: string, progress: (status: string, detail?: string, error?: string) => void) => Promise<void>)
    | null = null

  private createWorktreeHandler: ((baseBranch?: string, branchName?: string) => Promise<void>) | null = null

  private diffVirtualProvider: import("./DiffVirtualProvider").DiffVirtualProvider | undefined
  private diffViewerProvider: import("./diff/DiffViewerProvider").DiffViewerProvider | undefined
  private documentViewerProvider: import("./DocumentViewerProvider").DocumentViewerProvider | undefined
  private remoteService: RemoteStatusService | null = null
  private unsubscribeRemote: (() => void) | null = null

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
    private readonly extensionContext?: vscode.ExtensionContext,
    private readonly opts: CodeMProviderOptions = {},
  ) {
    this.projectDirectory = opts.projectDirectory
    this.slimEditMetadata = opts.slimEditMetadata ?? true
    this.appServerController = this.opts.appServer
      ? new MatureUiAppServerController({
          service: this.opts.appServer,
          cwdForThread: (threadId) => this.getWorkspaceDirectory(threadId),
          preparePrompt: (message) => prepareMatureUiPrompt(message, this.getWorkspaceDirectory(message.sessionID)),
          post: (message) => this.postMessage(message),
          selectThread: (threadId) => {
            this.contextSessionID = threadId ?? undefined
          },
        })
      : null
    this.appServerEvent = this.opts.appServer
      ? vscode.Disposable.from(
          vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("codem.intelligence") || event.affectsConfiguration("codem.permissionMode"))
              this.postPromptDefaults()
          }),
          this.opts.appServer.onEvent((event) => this.appServerController?.acceptEvent(event)),
          this.opts.appServer.onDidChangeSpace((space) => {
            if (space) void this.appServerController?.refreshSpace()
          }),
        )
      : null
    this.codeMAuthenticationChange =
      this.opts.authentication?.onDidChange((status) => {
        this.postMessage({ type: "profileData", data: codeMWebviewProfile(status) })
        if (status.loggedIn && status.routerCredential === true && this.appServerController) {
          void this.appServerController.handle({ type: "requestProviders" })
        }
      }) ?? null
  }

  setRemoteService(service: RemoteStatusService): void {
    this.remoteService = service
    this.unsubscribeRemote = service.onChange(() => this.sendRemoteStatus())
  }

  private setCurrentSession(session: Session | null): void {
    const ids = new Set([this.currentSession?.id, session?.id])
    for (const id of ids) {
      if (id) this.refreshes.set(id, (this.refreshes.get(id) ?? 0) + 1)
    }
    this.currentSession = session
    this.updateTitle()
  }

  private updateTitle(): void {
    if (!this.opts.tabTitle) return
    const title = nativeTitle(this.currentSession, this.activity, this.opts.tabLabel)
    if (this.caption === title) return
    this.caption = title
    this.opts.tabTitle(title)
  }

  private checkpoint(sid: string, run: () => Promise<void>): void {
    const prior = this.checkpoints.get(sid) ?? Promise.resolve()
    const pending = prior.catch(() => undefined).then(run)
    const cleanup = () => {
      if (this.checkpoints.get(sid) === pending) this.checkpoints.delete(sid)
    }
    this.checkpoints.set(sid, pending)
    void pending.then(cleanup, (error) => {
      console.error("[CodeM] checkpoint mutation failed:", error)
      cleanup()
    })
  }

  private stopCurrentSessionProcesses(next?: string): void {
    const sid = this.contextSessionID ?? this.currentSession?.id
    if (!sid || sid === next) return
    const session = this.currentSession?.id === sid ? this.currentSession : undefined
    void stopSessionProcesses(this.client, sid, this.getSessionDirectory(sid, session))
  }

  private sendRemoteStatus(): void {
    const s = this.remoteService?.getState()
    if (s) this.postMessage({ type: "remoteStatus", enabled: s.enabled, connected: s.connected })
  }
  private focusSession(id?: string): void {
    this.streams.focus(id)
    this.registerPresence()
  }

  /**
   * Report presence for this provider: the focused session is visible, and
   * open local tab sessions (plus the focused one) stay attached even while
   * the view is hidden.
   */
  private registerPresence(): void {
    if (this.opts.disableViewedRegistration) return
    const focused = this.streams.focused
    this.connectionService.registerVisible(this.instanceId, focused ? [focused] : [])
    const attached = new Set(this.openSessionIds)
    if (focused) attached.add(focused)
    this.connectionService.registerAttached(this.instanceId, [...attached])
  }

  public setStreamVisibility(active: boolean): void {
    this.visibleTaskStreams.setActive(active)
    this.active = active
    if (!this.isWebviewReady) return
    this.postMessage({ type: "webviewActiveChanged", active })
  }

  public setProjectDirectory(directory: string | null): void {
    if (this.projectDirectory === directory) return
    this.projectDirectory = directory
    this.providerUsageGeneration++
    this.cachedProviderUsageMessage = null
    this.postMessage({ type: "workspaceDirectoryChanged", directory: directory ?? "" })
    this.postMessage({ type: "configBindingExpired", reason: "project-changed" })
  }

  public setDiffVirtualProvider(provider: import("./DiffVirtualProvider").DiffVirtualProvider): void {
    this.diffVirtualProvider = provider
  }

  public setDiffViewerProvider(provider: import("./diff/DiffViewerProvider").DiffViewerProvider): void {
    this.diffViewerProvider = provider
  }

  public setReviewCommentsHandler(handler: ReviewCommentsHandler): void {
    this.reviewCommentsHandler = handler
  }

  public setDocumentViewerProvider(provider: import("./DocumentViewerProvider").DocumentViewerProvider): void {
    this.documentViewerProvider = provider
  }

  /**
   * Convenience getter that returns the shared SDK KiloClient or null if not yet connected.
   * Preserves the existing null-check pattern used throughout handler methods.
   */
  private get client(): KiloClient | null {
    try {
      return this.connectionService.getClient()
    } catch {
      return null
    }
  }

  private postConnectionState(error = this.connectionService.getConnectionError()): void {
    this.postMessage({
      type: "connectionState",
      state: this.connectionState,
      ...(this.connectionState === "error" && {
        error: getErrorMessage(error) || "Connection to CLI backend lost. Retry to reconnect.",
      }),
    })
  }

  // Strip metadata unused by the webview to keep session switches fast.
  // Logic in host/slim-metadata.ts.
  private slimInfo<T>(info: T): T {
    if (!this.slimEditMetadata) return info
    return slimInfo(info)
  }

  private slimPart<T>(part: T): T {
    if (!this.slimEditMetadata) return part
    return slimPart(part)
  }

  private slimParts<T>(parts: T[]) {
    if (!this.slimEditMetadata) return parts
    return slimParts(parts)
  }

  private get forkCtx() {
    return {
      connection: this.connectionService,
      post: (msg: { type: "error"; message: string }) => this.postMessage(msg),
      register: (session: Session) => this.registerSession(session),
      forked: (session: Session, sourceID: string) =>
        this.postMessage({ type: "sessionForked", sessionID: session.id, forkedFromID: sourceID }),
      status: (sessionID: string) => this.sessionStatusMap.get(sessionID),
      directory: (sessionID: string) => this.getWorkspaceDirectory(sessionID),
    }
  }

  private async syncWebviewState(reason: string): Promise<void> {
    const serverInfo = this.connectionService.getServerInfo()
    console.log("[CodeM] CodeMProvider: 🔄 syncWebviewState()", {
      reason,
      isWebviewReady: this.isWebviewReady,
      connectionState: this.connectionState,
      hasClient: !!this.client,
      hasServerInfo: !!serverInfo,
    })

    if (!this.isWebviewReady) {
      console.log("[CodeM] CodeMProvider: ⏭️ syncWebviewState skipped (webview not ready)")
      return
    }

    this.postPromptDefaults()

    // Always push connection state first so the UI can render appropriately.
    this.postConnectionState()

    // Re-send ready so the webview can recover after refresh.
    const langConfig = vscode.workspace.getConfiguration("codem")
    this.postMessage({
      type: "ready",
      ...(serverInfo ? { serverInfo } : {}),
      extensionVersion: this.extensionVersion,
      vscodeLanguage: vscode.env.language,
      languageOverride: langConfig.get<string>("language"),
      fontSize: getWebviewFontSize(),
      workspaceDirectory: this.getProjectDirectory(this.currentSession?.id),
    })

    const authentication = this.opts.authentication
    if (authentication) {
      const status = authentication.current ?? (await authentication.refresh())
      this.postMessage({ type: "profileData", data: codeMWebviewProfile(status) })
    }

    if (this.connectionState === "connected" && this.client) {
      if (this.currentSession) {
        this.refreshSessionDetails(this.currentSession.id, this.getWorkspaceDirectory(this.currentSession.id))
      }

      // Re-send cached worktree stats and git status after webview reload.
      if (this.cachedStats) this.postMessage(this.cachedStats)
      this.postMessage({ type: "gitStatus", repo: this.cachedGitRepo })

      void this.seedSessionStatusMap()

      this.sendRemoteStatus()
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.isWebviewReady = false
    this.webview = webviewView.webview

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview, true)
    this.setupWebviewMessageHandler(webviewView.webview)

    this.setSidebarVisible(webviewView.visible)
    this.visibilityDisposable?.dispose()
    this.visibilityDisposable = webviewView.onDidChangeVisibility(() => {
      this.setSidebarVisible(webviewView.visible)
      this.focusSession(webviewView.visible ? this.contextSessionID : undefined)
    })
    this.initializeConnection()
  }

  private setSidebarVisible(visible: boolean): void {
    this.setStatsVisible(visible)
    this.setStreamVisibility(visible)
    vscode.commands.executeCommand("setContext", "codem.sidebarVisible", visible)
    if (!visible && this.opts.focusContext) {
      void vscode.commands.executeCommand("setContext", this.opts.focusContext, false)
    }
  }

  /** Resolve a WebviewPanel for displaying CodeM in an editor tab. */
  public resolveWebviewPanel(panel: vscode.WebviewPanel): void {
    // WebviewPanel can be restored/reloaded; ensure we don't treat it as ready prematurely.
    this.isWebviewReady = false
    this.webview = panel.webview

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    panel.webview.html = this._getHtmlForWebview(panel.webview)

    this.setupWebviewMessageHandler(panel.webview)
    this.viewStateDisposable?.dispose()
    this.viewStateDisposable = this.visibleTaskStreams.bindPanel(panel, () => {
      this.setStatsVisible(panel.visible)
      this.setStreamVisibility(panel.active && panel.visible)
      if (this.opts.disableViewedRegistration) return
      const id = this.contextSessionID
      this.streams.focus(panel.visible ? id : undefined)
      this.connectionService.registerVisible(this.instanceId, panel.visible && id ? [id] : [])
    })
    this.setStatsVisible(panel.visible)
    this.setStreamVisibility(panel.active && panel.visible)
    this.initializeConnection()
  }

  /** Register a session created externally and notify the webview. */
  public registerSession(session: Session, activate = false): void {
    this.removedSessionIds.delete(session.id)
    this.stopCurrentSessionProcesses(session.id)
    this.setCurrentSession(session)
    this.contextSessionID = session.id
    this.trackedSessionIds.add(session.id)
    this.postMessage({
      type: "sessionCreated",
      projectId: this.opts.projectQualifier?.()?.projectId,
      session: this.sessionToWebview(session),
      ...(activate ? { activate: true } : {}),
    })
  }

  /** Add a session ID to the tracked set without changing currentSession. */
  public trackSession(sessionId: string): void {
    this.trackedSessionIds.add(sessionId)
  }

  public loadMessages(sessionID: string): Promise<void> {
    if (this.appServerController) {
      return this.appServerController.handle({ type: "loadMessages", sessionID, mode: "replace" }).then(() => undefined)
    }
    // Sub-agent viewers share the normal paginated transcript and preserve
    // live deltas that arrive while the initial page is loading.
    return this.handleLoadMessages(sessionID, { preserveStream: true })
  }

  /**
   * Register a directory override for a session (e.g., worktree path).
   * When set, all operations for this session use this directory instead of the workspace root.
   */
  public setSessionDirectory(sessionId: string, directory: string): void {
    const current = this.sessionDirectories.get(sessionId) ?? this.getRootDirectory()
    this.aborts.preserve(sessionId, this.sessionStatusMap.get(sessionId), current)
    this.sessionDirectories.set(sessionId, directory)
  }

  public clearSessionDirectory(sessionId: string): void {
    const current = this.sessionDirectories.get(sessionId) ?? this.getRootDirectory()
    this.aborts.preserve(sessionId, this.sessionStatusMap.get(sessionId), current)
    this.sessionDirectories.delete(sessionId)
    this.owners.delete(sessionId)
  }

  /** Exposes the session→directory map so callers outside the webview can resolve worktree paths. */
  public getSessionDirectories(): ReadonlyMap<string, string> {
    return this.sessionDirectories
  }

  /** Register a project root with the shared Agent Manager route service. */
  public registerProjectRoute(ref: ProjectRef, root: string, generation: number): void {
    this.opts.routeService?.registerProject(ref.projectId, root, generation)
  }

  /** Drop a project and all its session/worktree routes from the route service. */
  public unregisterProjectRoute(projectId: string): void {
    this.opts.routeService?.unregisterProject(projectId)
    for (const [sid, owner] of this.owners) {
      if (owner.project === projectId) this.owners.delete(sid)
    }
  }

  /** Register a worktree directory under a project. */
  public registerWorktreeRoute(ref: WorktreeRef, directory: string, generation: number): void {
    this.opts.routeService?.registerWorktree(ref, directory, generation)
  }

  /** Register a session directory under a project (exact routing). */
  public registerSessionRoute(ref: SessionRef, directory: string, generation: number): void {
    this.opts.routeService?.registerSession(ref, directory, generation)
  }

  /** Drop one session route, keeping the raw ambiguity index consistent. */
  public unregisterSessionRoute(ref: SessionRef): void {
    this.opts.routeService?.unregisterSession(ref)
  }

  /** Whether a raw session id is known to be ambiguous across projects. */
  public isSessionRouteAmbiguous(sessionId: string): boolean {
    return this.opts.routeService?.isSessionAmbiguous(sessionId) ?? false
  }

  /** Exact directory for a project-qualified session ref, or undefined. */
  public routeSessionDirectoryFor(ref: SessionRef): string | undefined {
    return this.opts.routeService?.trySessionDirectoryFor(ref)
  }

  public async getSessionInfo(sessionId: string): Promise<Session | undefined> {
    await this.initializeConnection()
    const client = this.client
    if (!client) return
    // Agent Manager: never query an ambiguous raw session id against the
    // active root. The same id may exist in two projects, and the
    // sessionDirectories map can only hold one entry per raw id, so falling
    // back to the active root would silently resolve the wrong project's
    // session. Require an exact route (qualified or unambiguous) instead.
    const routed = this.routeSessionDirectory(sessionId)
    if (routed === null) return undefined
    const directory = routed ?? this.getWorkspaceDirectory(sessionId)
    return retry(() => client.session.get({ sessionID: sessionId, directory }, { throwOnError: true }))
      .then((result) => result.data)
      .catch((error: unknown) => {
        console.warn("[CodeM] CodeMProvider: Failed to resolve managed session:", error)
        return undefined
      })
  }

  /** Return the currently active session ID, if any. */
  public getCurrentSessionId(): string | undefined {
    return this.currentSession?.id ?? undefined
  }

  public canReceiveReviewComments(): boolean {
    return this.webview !== null
  }

  /** Return the Git root used by the Changes panel for a session. */
  public getSessionGitDirectory(sessionId: string): string | undefined {
    return this.sessionGitDirectories.get(sessionId)
  }

  /**
   * Re-fetch and send the full session list to the webview.
   * Called by AgentManagerProvider after worktree recovery completes.
   */
  public refreshSessions(): void {
    void this.handleLoadSessions()
  }

  /** Register a listener invoked when a plan follow-up session is adopted. */
  public onFollowupAdopted(cb: (session: Session, directory: string) => void): void {
    this.followupListeners.push(cb)
  }

  /** Recover permission/question prompts after sessions and directories are tracked. */
  public recoverPendingPrompts(): void {
    this.promptRecoveryQueued = true
    if (!this.isWebviewReady) return
    if (!this.client) return
    if (this.promptRecovery) return

    this.promptRecovery = this.flushPendingPrompts().finally(() => {
      this.promptRecovery = null
      if (this.promptRecoveryQueued && this.isWebviewReady && this.client) this.recoverPendingPrompts()
    })
  }

  private trackOpenSessions(ids: string[]): void {
    const next = new Set(ids)
    for (const id of this.openSessionIds) {
      if (!next.has(id)) this.trackedSessionIds.delete(id)
    }
    this.openSessionIds.clear()
    for (const id of next) {
      this.openSessionIds.add(id)
      this.trackedSessionIds.add(id)
    }
    const now = Date.now()
    for (const [key, session] of this.draftSessions) {
      if (next.has(session.sid) || session.expires <= now) this.draftSessions.delete(key)
    }
    this.registerPresence()
    this.recoverPendingPrompts()
  }

  private async flushPendingPrompts(): Promise<void> {
    while (this.promptRecoveryQueued && this.isWebviewReady) {
      if (!this.client) return
      this.promptRecoveryQueued = false
      await Promise.all([
        fetchAndSendPendingPermissions(this.permissionCtx),
        fetchAndSendPendingQuestions(this.questionCtx),
      ])
    }
  }

  public openCloudSession(sessionId: string): void {
    this.postMessage({ type: "openCloudSession", sessionId })
  }

  public rememberSession(sessionID: string, directory?: string): void {
    if (directory) this.sessionDirectories.set(sessionID, directory)
  }

  public async openSession(sessionID: string, directory?: string): Promise<void> {
    this.rememberSession(sessionID, directory)
    await this.waitForReady()
    this.postMessage({ type: "openSession", sessionID })
  }

  public selectKiloModel(modelID?: string, agent?: string): void {
    if (!modelID && !agent) return
    this.pendingKiloModel = { ...(modelID && { modelID }), ...(agent && { agent }) }
    this.flushPendingKiloModel()
  }

  public setContinueInWorktreeHandler(
    handler: (sessionId: string, progress: (status: string, detail?: string, error?: string) => void) => Promise<void>,
  ): void {
    this.continueInWorktreeHandler = handler
  }

  public setCreateWorktreeHandler(handler: (baseBranch?: string, branchName?: string) => Promise<void>): void {
    this.createWorktreeHandler = handler
  }

  public attachToWebview(
    webview: vscode.Webview,
    options?: { onBeforeMessage?: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null> },
  ): void {
    this.isWebviewReady = false
    this.webview = webview
    this.onBeforeMessage = options?.onBeforeMessage ?? null
    this.setupWebviewMessageHandler(webview)
    this.initializeConnection()
  }

  private acknowledge(message: Record<string, unknown>): boolean {
    if (message.type !== "acknowledgeSession") return false
    if (typeof message.sessionID === "string" && typeof message.eventID === "string") {
      this.connectionService.notifySessionAcknowledged(message.sessionID, message.eventID)
    }
    return true
  }

  private async handleAppServerMessage(message: WebviewMessage): Promise<boolean> {
    if (!this.appServerController) return false
    if (!Object.hasOwn(CODEM_UI_INTERACTION_OWNERS, message.type)) {
      this.postMessage({ type: "error", message: `Unsupported CodeM Webview command: ${message.type}` })
      return true
    }
    if (await this.appServerController.handle(message)) return true
    const owner = CODEM_UI_INTERACTION_OWNERS[message.type as CodeMUiInteractionType]
    // app-server-control used to fall through to Kilo; that leak is closed.
    if (!isAppServerOwned(owner)) return false
    this.postMessage({
      type: "error",
      message: unmigratedAppServerCommandMessage(message.type),
      ...(typeof message.sessionID === "string" ? { sessionID: message.sessionID } : {}),
    })
    return true
  }

  private setupWebviewMessageHandler(webview: vscode.Webview): void {
    this.webviewMessageDisposable?.dispose()
    this.unsubscribeAcknowledged?.()
    this.unsubscribeAcknowledged = this.connectionService.onSessionAcknowledged((sessionID, eventID) => {
      this.postMessage({ type: "sessionAcknowledged", sessionID, eventID })
    })
    this.setFocusTarget("other")
    this.autocompleteConfigDisposable?.dispose()
    this.autocompleteConfigDisposable = watchAutocompleteConfig((msg) => this.postMessage(msg))
    this.chatConfigDisposable?.dispose()
    this.chatConfigDisposable = watchChatConfig((msg) => this.postMessage(msg))
    this.throughputConfigDisposable?.dispose()
    this.throughputConfigDisposable = watchThroughputConfig((msg) => this.postMessage(msg))
    this.autoApprovalReasonConfigDisposable?.dispose()
    this.autoApprovalReasonConfigDisposable = watchAutoApprovalReasonConfig((msg) => this.postMessage(msg))
    this.pushFixesConfigDisposable?.dispose()
    this.pushFixesConfigDisposable = watchPushFixesConfig((msg) => this.postMessage(msg))
    this.webviewMessageDisposable = webview.onDidReceiveMessage(async (message) => {
      if (this.acknowledge(message)) return
      const intercepted = await interceptMessage(message, {
        workspaceDir: (sid) => this.getWorkspaceDirectory(sid ?? this.currentSession?.id),
        post: (m) => this.postMessage(m),
        error: getErrorMessage,
        before: this.onBeforeMessage,
      })
      if (intercepted === null) return
      message = intercepted

      if (await this.handleAppServerMessage(message)) return

      if (
        await routeEarlyMessage(message, {
          client: this.client,
          post: (msg) => this.postMessage(msg),
          browserSettings: () => this.sendBrowserSettings(),
          exportTranscript: (sessionID) => this.handleExportSessionTranscript(sessionID),
          copy: (text) => vscode.env.clipboard.writeText(text),
          openSessions: (ids) => this.trackOpenSessions(ids),
          activity: (state) => {
            if (!isActivity(state)) return
            this.activity = state
            this.updateTitle()
          },
          modelUsage: (msg) => handleModelUsageMessage(msg, this.extensionContext, (value) => this.postMessage(value)),
          backgroundJobs: (sessionID, requestID) => this.fetchAndSendBackgroundJobs(sessionID, requestID),
          board: (msg) => this.handleBoardMessage(msg),
          cancelBackgroundJob: (jobID, sessionID, requestID) => this.cancelBackgroundJob(jobID, sessionID, requestID),
          caffeination: () => void vscode.commands.executeCommand("codem.toggleCaffeination"),
        })
      ) {
        return
      }
      if (this.handleEditorOpenMessage(message)) return
      if (await this.handleAgentManagerSettingsMessage(message)) return
      if (
        await handleWorkStyleMessage({
          message,
          connection: this.connectionService,
          directory: this.getWorkspaceDirectory(this.currentSession?.id),
          post: (msg) => this.postMessage(msg),
        })
      )
        return
      if (
        await handleSidebarWorktreeMessage(message, {
          post: (msg) => this.postMessage(msg),
          openAgentManager: () => vscode.commands.executeCommand("codem.agentManagerOpen"),
          openAdvancedWorktree: () => vscode.commands.executeCommand("codem.agentManager.advancedWorktree"),
          openChanges: (sessionId?: string, turnId?: string) => this.openChanges(sessionId, turnId),
          openProfile: () => vscode.commands.executeCommand("codem.profileButtonClicked"),
          currentSessionId: this.currentSession?.id,
          createWorktree: async (baseBranch, branchName) => {
            await this.createWorktreeHandler?.(baseBranch, branchName)
          },
          continueInWorktree: this.continueInWorktreeHandler ?? undefined,
        })
      ) {
        return
      }
      this.handleWebviewFocusMessage(message)
      this.visibleTaskStreams.handle(message)
      this.handleStreamVisibilityMessage(message)
      if (this.handleChildSyncMessage(message)) return
      if (await this.handleProfileDataMessage(message)) return
      if (this.handleNotificationSettingsMessage(message)) return
      switch (message.type) {
        case "webviewReady":
          console.log("[CodeM] CodeMProvider: ✅ webviewReady received")
          this.isWebviewReady = true
          for (const event of this.connectionService.getPendingCompletions()) {
            this.postMessage(mapSSEEventToWebviewMessage(event, event.properties.sessionID))
          }
          this.postMessage({ type: "webviewActiveChanged", active: this.active })
          this.visibleTaskStreams.clear()
          this.flushPendingKiloModel()
          await this.syncWebviewState("webviewReady")
          this.flushPendingReviewComments()
          this.recoverPendingPrompts()
          this.readyResolvers.splice(0).forEach((r) => r())
          break
        case "sendMessage": {
          await this.sendWebviewMessage(message as SendWebviewMessage)
          break
        }
        case "sendCommand": {
          const msg = message as typeof message & ContextMessage
          await this.handleSendCommand(
            message.command,
            message.arguments,
            typeof message.messageID === "string" ? message.messageID : undefined,
            message.sessionID,
            typeof message.draftID === "string" ? message.draftID : undefined,
            message.providerID,
            message.modelID,
            message.agent,
            message.variant,
            parseMessageFiles(message.files),
            typeof message.agentManagerContext === "string" ? message.agentManagerContext : undefined,
            typeof msg.contextDirectory === "string" ? msg.contextDirectory : undefined,
          )
          break
        }
        case "abort":
          this.cancelRetry(message.sessionID ?? "")
          await this.handleAbort(message.sessionID, message.scope)
          break
        case "permissionResponse":
          await handlePermissionResponse(
            this.permissionCtx,
            message.permissionId,
            message.sessionID,
            message.response,
            message.approvedAlways,
            message.deniedAlways,
          )
          break
        case "createSession":
          await this.handleCreateSession()
          break
        case "clearSession":
          this.stopCurrentSessionProcesses()
          this.contextSessionID = undefined
          this.appServerController?.clearSelection()
          this.setCurrentSession(null)
          this.focusSession()
          break
        case "loadMessages":
          // Don't await: allow parallel loads so rapid session switching
          // isn't blocked by slow responses for earlier sessions.
          void this.handleLoadMessages(message.sessionID, {
            mode: message.mode,
            focus: message.focus,
            before: message.before,
            limit: message.limit,
          })
          break
        case "loadSessions":
          this.handleLoadSessions().catch((e) => console.error("[CodeM] handleLoadSessions failed:", e))
          break
        case "requestSessionModelUsage":
          void this.fetchAndSendSessionModelUsage(message.sessionID, message.requestID)
          break
        case "login": {
          const attempt = ++this.loginAttempt
          await this.handleCodeMLogin(attempt)
          break
        }
        case "cancelLogin":
          this.loginAttempt++
          await this.handleCodeMLoginCancellation()
          break
        case "logout":
          await this.handleCodeMLogout()
          break
        case "setOrganization":
          if (typeof message.organizationId === "string" || message.organizationId === null) {
            await handleSetOrganization(this.authCtx, message.organizationId)
          }
          break
        case "openSettingsPanel":
          vscode.commands.executeCommand("codem.settingsButtonClicked", message.tab, message.projectId)
          break
        case "openVSCodeSettings":
          vscode.commands.executeCommand("workbench.action.openSettings", message.query)
          break
        case "openConfigFile":
          await openConfig(message.scope, message.labels, this.getProjectDirectory(this.currentSession?.id))
          break
        case "forkSession":
          handleForkSession(this.forkCtx, message.sessionId, message.messageId).catch((e) =>
            console.error("[CodeM] handleForkSession failed:", e),
          )
          break
        case "retryConnection":
          console.log("[CodeM] CodeMProvider: 🔄 Retrying connection...")
          this.initializeConnection().catch((e) =>
            console.error("[CodeM] CodeMProvider: ❌ Retry connection failed:", e),
          )
          break
        case "reload":
          this.handleReload().catch((e) => console.error("[CodeM] CodeMProvider: Reload failed:", e))
          break
        case "openSubAgentViewer":
          vscode.commands.executeCommand(
            "codem.openSubAgentViewer",
            message.sessionID,
            message.title,
            this.getWorkspaceDirectory(message.parentSessionID),
          )
          break
        case "saveImage":
          return saveImage(this.getWorkspaceDirectory(this.currentSession?.id), message)
        case "requestProviders":
          this.fetchAndSendProviders().catch((e) => console.error("[CodeM] fetchAndSendProviders failed:", e))
          break
        case "anacondaDesktopStatus":
        case "anacondaDesktopOpen":
        case "anacondaDesktopSync":
        case "cancelAnacondaDesktopRequest":
          await this.anacondaDesktop.handle(message, {
            client: this.client,
            directory: this.getWorkspaceDirectory(),
            post: (reply) => this.postMessage(reply),
            refresh: () => this.fetchAndSendProviders(),
            error: getErrorMessage,
          })
          break
        case "compact":
          await this.handleCompact(message.sessionID, message.providerID, message.modelID)
          break
        case "requestSkills":
          this.fetchAndSendSkills().catch((e) => console.error("[CodeM] fetchAndSendSkills failed:", e))
          break
        case "questionReply":
          this.noteFollowup(message.answers, message.sessionID)
          if (!(await handleQuestionReply(this.questionCtx, message.requestID, message.answers, message.sessionID))) {
            this.pendingFollowup = null
          }
          break
        case "questionReject":
          this.pendingFollowup = null
          await handleQuestionReject(this.questionCtx, message.requestID, message.sessionID)
          break
        case "sessionCostAlertResponse":
          await this.handleCostAlertResponse(message.sessionID, message.limit, message.response)
          break
        case "openSettingsTab":
          break
        case "setLanguage":
          await vscode.workspace
            .getConfiguration("codem")
            .update("language", message.locale || undefined, vscode.ConfigurationTarget.Global)
          this.connectionService.notifyLanguageChanged(message.locale as string)
          break
        case "requestChatCompletion": {
          if (!this.chatAutocomplete) {
            this.chatAutocomplete = new ChatTextAreaAutocomplete(this.connectionService)
          }
          void this.chatAutocomplete.handle(
            { type: "requestChatCompletion", text: message.text, requestId: message.requestId },
            {
              postMessage: (msg: { type: "chatCompletionResult"; text: string; requestId: string }) =>
                this.postMessage(msg),
            },
          )
          break
        }
        case "requestFileSearch":
        case "requestSessionSearch":
        case "requestFilePicker":
        case "requestTerminalContext":
          await this.handleContextRequest(message)
          break
        case "toggleRemote":
        case "setRemoteEnabled":
        case "requestRemoteStatus":
          this.remoteService
            ?.handleMessage(message.type, message.enabled)
            .then((s) => {
              if (s) this.sendRemoteStatus()
            })
            .catch((err) => console.error("[CodeM] remote message failed:", err))
          break
        case "deleteSession":
          await this.handleDeleteSession(message.sessionID)
          break
        case "renameSession":
          await this.handleRenameSession(message.sessionID, message.title)
          break
        case "updateSetting":
          await this.handleUpdateSetting(message.key, message.value)
          break
        case "requestClaudeCompatSetting":
          this.sendClaudeCompatSetting()
          break
        case "requestTimelineSetting":
          this.sendTimelineSetting()
          break
        case "requestNotifications":
          this.fetchAndSendNotifications().catch((e) =>
            console.error("[CodeM] fetchAndSendNotifications failed:", e),
          )
          break
        case "requestCloudSessions":
          await handleRequestCloudSessions(this.cloudSessionCtx, message)
          break
        case "requestGitRemoteUrl":
          void this.getGitRemoteUrl().then((url) => {
            this.postMessage({ type: "gitRemoteUrlLoaded", gitUrl: url ?? null })
          })
          break
        case "requestCloudSessionData":
          void handleRequestCloudSessionData(this.cloudSessionCtx, message.sessionId)
          break
        case "importAndSend": {
          const files = parseMessageFiles(message.files)
          const feedback = feedbackMessage(message)
          void handleImportAndSend(
            this.cloudSessionCtx,
            message.cloudSessionId,
            message.text,
            typeof message.messageID === "string" ? message.messageID : undefined,
            message.providerID,
            message.modelID,
            message.agent,
            message.variant,
            files,
            feedback?.review,
            typeof message.command === "string" ? message.command : undefined,
            typeof message.commandArgs === "string" ? message.commandArgs : undefined,
            feedback?.browserFeedback,
          )
          break
        }
        case "dismissNotification":
          await this.handleDismissNotification(message.notificationId)
          break
        case "resetAllSettings":
          await this.handleResetAllSettings()
          break
        case "resetReadNotifications":
          await resetReadNotifications(this.notificationsContext())
          break
        case "persistVariant": {
          const stored = this.extensionContext?.globalState.get<Record<string, string>>("variantSelections") ?? {}
          stored[message.key] = message.value
          await this.extensionContext?.globalState.update("variantSelections", stored)
          break
        }
        case "requestVariants": {
          const variants = this.extensionContext?.globalState.get<Record<string, string>>("variantSelections") ?? {}
          this.postMessage({ type: "variantsLoaded", variants })
          break
        }
        case "persistRecents":
          await this.extensionContext?.globalState.update("recentModels", validateRecents(message.recents))
          break
        case "requestRecents": {
          const recents = validateRecents(this.extensionContext?.globalState.get("recentModels"))
          this.postMessage({ type: "recentsLoaded", recents })
          break
        }
        case "toggleFavorite": {
          await this.toggleFavorite(message)
          break
        }
        case "requestFavorites": {
          const favorites = validateFavorites(this.extensionContext?.globalState.get("favoriteModels"))
          this.postMessage({ type: "favoritesLoaded", favorites })
          break
        }
        case "enhancePrompt": {
          const sdkClient = this.client
          if (!sdkClient) {
            this.postMessage({
              type: "enhancePromptError",
              error: "Not connected to CLI backend",
              requestId: message.requestId,
            })
            break
          }
          void sdkClient.enhancePrompt
            .enhance({ text: message.text }, { throwOnError: true })
            .then(({ data }) => {
              this.postMessage({ type: "enhancePromptResult", text: data.text, requestId: message.requestId })
            })
            .catch((err: unknown) => {
              const raw = getErrorMessage(err) || "Failed to enhance prompt"
              const msg = normalizeEnhancePromptErrorMessage(raw)
              console.error("[CodeM] CodeMProvider: Failed to enhance prompt:", err)
              vscode.window.showErrorMessage(`Enhance prompt failed: ${msg}`)
              this.postMessage({
                type: "enhancePromptError",
                error: msg,
                requestId: message.requestId,
              })
            })
          break
        }
      }
    })
    this.webviewMessageDisposable = watchFontSizeConfig((msg) => this.postMessage(msg), this.webviewMessageDisposable)
    this.webviewMessageDisposable = watchWorkStyleConfig((msg) => this.postMessage(msg), this.webviewMessageDisposable)
  }

  private async sendWebviewMessage(message: SendWebviewMessage): Promise<void> {
    const feedback = feedbackMessage(message)
    await this.handleSendMessage(
      message.text,
      typeof message.messageID === "string" ? message.messageID : undefined,
      message.sessionID,
      typeof message.draftID === "string" ? message.draftID : undefined,
      message.providerID,
      message.modelID,
      message.agent,
      message.variant,
      parseMessageFiles(message.files),
      feedback?.review,
      typeof message.agentManagerContext === "string" ? message.agentManagerContext : undefined,
      typeof message.contextDirectory === "string" ? message.contextDirectory : undefined,
      feedback?.browserFeedback,
    )
  }

  private async handleProfileDataMessage(message: TypedWebviewMessage): Promise<boolean> {
    if (message.type === "refreshProfile") {
      const authentication = this.opts.authentication
      if (!authentication) {
        this.postMessage({ type: "error", message: "CodeM authentication is unavailable" })
        return true
      }
      const status = await authentication.refresh()
      this.postMessage({ type: "profileData", data: codeMWebviewProfile(status) })
      return true
    }
    if (message.type === "requestProviderUsage") {
      await this.fetchAndSendProviderUsage()
      return true
    }
    if (message.type === "refreshProviderUsage") {
      await this.fetchAndSendProviderUsage(true)
      return true
    }
    return false
  }

  private async handleCodeMLogin(attempt: number): Promise<void> {
    const authentication = this.opts.authentication
    if (!authentication) {
      this.postMessage({ type: "deviceAuthFailed", error: "CodeM authentication is unavailable" })
      return
    }
    try {
      const status = await authentication.signIn()
      if (attempt !== this.loginAttempt) return
      this.postMessage({ type: "profileData", data: codeMWebviewProfile(status) })
      this.postMessage({ type: "deviceAuthComplete" })
    } catch (error: unknown) {
      if (attempt !== this.loginAttempt) return
      this.postMessage({ type: "deviceAuthFailed", error: getErrorMessage(error) || "CodeM login failed" })
    }
  }

  private async handleCodeMLoginCancellation(): Promise<void> {
    await this.opts.authentication?.cancelSignIn()
    this.postMessage({ type: "deviceAuthCancelled" })
  }

  private async handleCodeMLogout(): Promise<void> {
    const authentication = this.opts.authentication
    if (!authentication) {
      this.postMessage({ type: "error", message: "CodeM authentication is unavailable" })
      return
    }
    const status = await authentication.signOut()
    this.postMessage({ type: "profileData", data: codeMWebviewProfile(status) })
  }

  private handleWebviewFocusMessage(message: TypedWebviewMessage & { focused?: unknown; target?: unknown }): void {
    if (message.type === "webviewFocusChanged" && this.opts.focusContext) {
      void vscode.commands.executeCommand("setContext", this.opts.focusContext, message.focused === true)
    }
    if (message.type === "webviewFocusChanged" && message.focused === true) {
      if (this.opts.focusTargetContext) this.postMessage({ type: "agentManager.focusContextRequested" })
      return
    }
    if (message.type === "webviewFocusChanged" && message.focused !== true) {
      this.setFocusTarget("other")
      return
    }
    if (message.type !== "agentManagerFocusChanged") return
    const target =
      message.target === "prompt" || message.target === "mainTerminal" || message.target === "sideTerminal"
        ? message.target
        : "other"
    this.setFocusTarget(target)
  }

  private setFocusTarget(target: "prompt" | "mainTerminal" | "sideTerminal" | "other"): void {
    const contexts = this.opts.focusTargetContext
    if (!contexts) return
    void vscode.commands.executeCommand("setContext", contexts.prompt, target === "prompt")
    void vscode.commands.executeCommand("setContext", contexts.mainTerminal, target === "mainTerminal")
    void vscode.commands.executeCommand("setContext", contexts.sideTerminal, target === "sideTerminal")
  }

  private handleChildSyncMessage(
    message: TypedWebviewMessage & { sessionID?: unknown; parentSessionID?: unknown; scope?: unknown },
  ): boolean {
    if (message.type !== "syncSession" && message.type !== "unsyncSession") return false
    if (typeof message.sessionID !== "string") return true
    if (message.type === "syncSession") {
      if (message.scope === "inspector") this.inspectorSessionIds.add(message.sessionID)
      const parent = typeof message.parentSessionID === "string" ? message.parentSessionID : undefined
      this.handleSyncSession(message.sessionID, parent).catch((e) =>
        console.error("[CodeM] handleSyncSession failed:", e),
      )
      return true
    }
    if (message.scope === "inspector") this.inspectorSessionIds.delete(message.sessionID)
    this.releaseChildSession(message.sessionID)
    return true
  }

  private handleStreamVisibilityMessage(
    message: TypedWebviewMessage & { sessionID?: unknown; visible?: unknown },
  ): void {
    if (message.type !== "streamSessionVisible" || message.visible !== false || typeof message.sessionID !== "string") {
      return
    }
    this.releaseChildSession(message.sessionID)
  }

  private async openChanges(sessionId?: string, turnId?: string, comment?: PRReviewCommentData): Promise<void> {
    const id = sessionId ?? this.currentSession?.id
    const dir = this.routeSessionDirectory(id)
    if (dir === null) return
    const directory = comment
      ? (dir ?? this.getWorkspaceDirectory(id))
      : id
        ? this.sessionGitDirectories.get(id)
        : undefined
    const args = {
      sessionId: id,
      turnId,
      directory,
      comment,
      beside: this.opts.topBarSurface === "tab",
      onComments: (comments: unknown[], autoSend: boolean) => {
        if (!this.canReceiveReviewComments() && this.reviewCommentsHandler) {
          const draft = id?.startsWith("sidebar-pending:") || id?.startsWith("pending:")
          this.reviewCommentsHandler(comments, draft ? false : autoSend, draft ? undefined : id, directory)
          return
        }
        void this.appendReviewComments(comments, autoSend, id)
      },
    }
    if (this.diffViewerProvider) {
      this.diffViewerProvider.openFromCommand(args)
      return
    }
    await vscode.commands.executeCommand("codem.showChanges", args)
  }

  private handleEditorOpenMessage(message: Parameters<typeof handleEditorAction>[0]): boolean {
    return handleEditorAction(message, {
      // An explicit sessionID (e.g. from validateFiles) takes precedence over
      // the live currentSession — see editor-actions.ts's validateFiles case.
      dir: (sessionID) => this.getWorkspaceDirectory(sessionID ?? this.currentSession?.id),
      diff: this.diffVirtualProvider,
      openPRComment: (comment, sessionID) => this.openChanges(sessionID, undefined, comment),
      openMarkdown: (file, sessionID) => {
        if (!this.documentViewerProvider) return false
        this.documentViewerProvider.openFromCommand({
          sessionId: sessionID,
          directory: this.getWorkspaceDirectory(sessionID ?? this.currentSession?.id),
          file,
        })
        return true
      },
      storage: this.extensionContext?.globalStorageUri,
      post: (msg) => this.postMessage(msg),
    })
  }

  /** Notifications settings traffic, kept out of the main switch to bound its complexity. */
  private handleNotificationSettingsMessage(message: { type: string; sound?: string }): boolean {
    switch (message.type) {
      case "requestNotificationSettings":
        this.sendNotificationSettings()
        break
      case "testNotification":
        previewSound(message.sound ?? "default")
        break
      case "testOSNotification":
        void this.handleTestOSNotification()
        break
      default:
        return false
    }
    return true
  }

  private async toggleFavorite(message: {
    action: "add" | "remove"
    providerID: string
    modelID: string
  }): Promise<void> {
    const current = validateFavorites(this.extensionContext?.globalState.get("favoriteModels"))
    const key = `${message.providerID}/${message.modelID}`
    const exists = current.some((f) => `${f.providerID}/${f.modelID}` === key)
    const favorites =
      message.action === "add" && !exists
        ? [...current, { providerID: message.providerID, modelID: message.modelID }]
        : message.action === "remove" && exists
          ? current.filter((f) => `${f.providerID}/${f.modelID}` !== key)
          : current
    await this.extensionContext?.globalState.update("favoriteModels", favorites)
    this.connectionService.notifyFavoritesChanged(favorites)
  }

  /**
   * Initialize connection to the CLI backend server.
   * Subscribes to the shared KiloConnectionService.
   */
  private initializeConnection(): Promise<void> {
    if (this.initConnectionPromise) {
      return this.initConnectionPromise
    }
    this.initConnectionPromise = this.doInitializeConnection().finally(() => {
      this.initConnectionPromise = null
    })
    return this.initConnectionPromise
  }

  private async doInitializeConnection(): Promise<void> {
    console.log("[CodeM] CodeMProvider: 🔧 Starting initializeConnection...")

    this.connectionState = "connecting"
    this.connectionGeneration++
    this.postMessage({ type: "connectionState", state: "connecting" })

    // Clean up any existing subscriptions (e.g., sidebar re-shown)
    this.unsubscribeEvent?.()
    this.unsubscribeState?.()
    this.unsubscribeNotificationDismiss?.()
    this.unsubscribeLanguageChange?.()
    this.unsubscribeFavoritesChange?.()
    this.unsubscribeClearPendingPrompts?.()
    this.unsubscribeDirectoryProvider?.()

    try {
      // App Server is the only live transport. Do not start kilo serve here.
      // Test fixtures may still inject a Kilo client; production connect() fail-closes.
      this.flushPendingKiloModel()

      // Subscribe to SSE events for this webview (filtered by tracked sessions)
      this.unsubscribeEvent = this.connectionService.onEventFiltered(
        (payload, directory) => {
          const event = unwrapSyncEvent(payload)
          if (!event) return false
          if (event.type === "indexing.status") return false
          if (
            directory &&
            directory !== "global" &&
            !this.isCurrentProjectDirectory(directory) &&
            !this.terminal(event, directory)
          )
            return false
          if (!directory && isEventFromForeignProject(payload, this.projectID)) return false

          // Remote status events are global and should always pass through
          if (event.type === "kilo-sessions.remote-status-changed") return true
          if (event.type === "memory.status" || event.type === "memory.updated" || event.type === "memory.error")
            return false
          const sessionId = this.resolveEventSessionId(event)

          // message.part.* events are always session-scoped; drop if session unknown.
          if (!sessionId) return !isSessionScopedPartEvent(event.type)
          if (!directory && !this.isCurrentProjectSession(sessionId)) return false

          if (event.type === "session.created" && this.matchesPendingFollowup(event.properties.info)) {
            return true
          }

          // session.status must always pass through — even for sessions not tracked by this
          // CodeMProvider instance. The Settings panel is a separate provider with no tracked
          // sessions, but it needs session.status to populate sessionStatusMap and allStatusMap
          // for the busy-session warning on Save.
          if (event.type === "session.status") return true

          // session.deleted must always pass through so the webview can run its cleanup
          // (messages, parts, stash, todos, permissions, drafts, etc.) — including for
          // sessions that were never explicitly tracked here (e.g. child sessions
          // cascade-deleted with the parent, or external CLI deletions). We deliberately
          // do NOT re-track the deleted id: handleLoadMessages intentionally drops late
          // responses for sessions that have been pruned, and re-tracking would let an
          // in-flight messagesLoaded response resurrect transcript state for a session
          // the webview just cleaned up.
          if (event.type === "session.deleted") return true

          return this.trackedSessionIds.has(sessionId)
        },
        (payload, directory) => {
          const event = unwrapSyncEvent(payload)
          if (event) this.handleEvent(event, directory)
        },
      )

      // Subscribe to connection state changes
      this.unsubscribeState = this.connectionService.onStateChange(async (state, error) => {
        if (this.connectionState !== state) {
          this.connectionGeneration++
        }
        this.connectionState = state
        this.postConnectionState(error)

        if (state === "connected") {
          this.flushPendingKiloModel()
          // Fire config warnings independently so a failure in the
          // sequential await chain doesn't prevent warnings from being shown
          void this.checkConfigWarnings("state")
          try {
            await this.syncWebviewState("sse-connected")
            await this.flushPendingSessionRefresh("sse-connected")
            this.recoverPendingPrompts()
          } catch (error) {
            console.error("[CodeM] CodeMProvider: ❌ Failed during connected state handling:", error)
            this.postMessage({
              type: "error",
              message: getErrorMessage(error) || "Failed to sync after connecting",
            })
          }
        }
      })

      // Subscribe to notification dismiss broadcast from other CodeMProvider instances
      this.unsubscribeNotificationDismiss = this.connectionService.onNotificationDismissed(() => {
        this.fetchAndSendNotifications()
      })

      // Subscribe to language change broadcast from other CodeMProvider instances
      this.unsubscribeLanguageChange = this.connectionService.onLanguageChanged((locale) => {
        this.postMessage({ type: "languageChanged", locale })
      })

      // Subscribe to favorites change broadcast from other CodeMProvider instances
      this.unsubscribeFavoritesChange = this.connectionService.onFavoritesChanged((favorites) => {
        this.postMessage({ type: "favoritesLoaded", favorites })
      })

      // Subscribe to clear-pending-prompts broadcast (fired after config save drains prompts)
      this.unsubscribeClearPendingPrompts = this.connectionService.onClearPendingPrompts(() => {
        this.postMessage({ type: "clearPendingPrompts" })
      })

      // Register this provider's directories so drainPendingPrompts() covers all instances
      this.unsubscribeDirectoryProvider = this.connectionService.registerDirectoryProvider(() => {
        return [this.getWorkspaceDirectory(), ...this.sessionDirectories.values()]
      })

      // Host is ready for App Server chat without a Kilo REST/SSE process.
      const serverInfo = this.connectionService.getServerInfo()
      this.connectionState = "connected"
      const langConfig = vscode.workspace.getConfiguration("codem")
      this.postMessage({
        type: "ready",
        ...(serverInfo ? { serverInfo } : {}),
        extensionVersion: this.extensionVersion,
        vscodeLanguage: vscode.env.language,
        languageOverride: langConfig.get<string>("language"),
        fontSize: getWebviewFontSize(),
        workspaceDirectory: this.getProjectDirectory(this.currentSession?.id),
      })
      this.postConnectionState()
      void this.checkConfigWarnings("init")

      await this.syncWebviewState("initializeConnection")
      await this.flushPendingSessionRefresh("initializeConnection")
      this.recoverPendingPrompts()

      // Fetch providers, agents, skills, config, notifications, and session statuses in parallel
      await Promise.all([
        this.refreshLiveCatalogs(),
        this.fetchAndSendNotifications(),
        this.seedSessionStatusMap(),
      ])
      await this.refreshGitStatus(this.getWorkspaceDirectory())
      this.sendNotificationSettings()
      this.sendTimelineSetting()
      this.postMessage(buildThroughputSettingMessage())
      this.postMessage(buildAutoApprovalReasonSettingMessage())
      this.postMessage({ type: "extensionDataReady" })

      console.log("[CodeM] CodeMProvider: ✅ initializeConnection completed successfully")
    } catch (error) {
      console.error("[CodeM] CodeMProvider: ❌ Failed to initialize connection:", error)
      this.connectionState = "error"
      this.postMessage({
        type: "connectionState",
        state: "error",
        error: getErrorMessage(error) || "Failed to connect to CLI backend",
        ...(error instanceof ServerStartupError && {
          userMessage: error.userMessage,
          userDetails: error.userDetails,
        }),
      })
    }
  }

  private sessionToWebview(session: Session) {
    return sessionToWebview(session)
  }

  private async handleCreateSession(): Promise<void> {
    if (!this.client) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    try {
      const workspaceDir = this.getContextDirectory()
      const metadata = await sandboxSessionMetadata(this.connectionService.sandboxPreference, this.client, workspaceDir)
      const { data: session } = await this.client.session.create(
        { directory: workspaceDir, platform: this.opts.platform, metadata },
        { throwOnError: true },
      )
      this.stopCurrentSessionProcesses(session.id)
      this.setCurrentSession(session)
      this.contextSessionID = session.id
      this.focusSession(session.id)
      this.trackDirectory(session.id, workspaceDir)
      this.trackedSessionIds.add(session.id)

      // Notify webview of the new session
      this.postMessage({
        type: "sessionCreated",
        projectId: this.opts.projectQualifier?.()?.projectId,
        session: this.sessionToWebview(this.currentSession!),
      })
    } catch (error) {
      console.error("[CodeM] CodeMProvider: Failed to create session:", error)
      this.postMessage({
        type: "error",
        message: getErrorMessage(error) || "Failed to create session",
      })
    }
  }

  /** Non-blocking: refresh session metadata + status for the webview after switching. */
  private async refreshSessionDetails(
    sessionID: string,
    dir: string,
    signal?: AbortSignal,
  ): Promise<Session | undefined> {
    if (!this.client) return
    void this.refreshGitStatus(this.sessionGitDirectories.get(sessionID) ?? dir, sessionID)
    const revision = this.revisions.get(sessionID)
    const refresh = (this.refreshes.get(sessionID) ?? 0) + 1
    this.refreshes.set(sessionID, refresh)
    const details = this.client.session
      .get({ sessionID, directory: dir })
      .then((r) => {
        if (!r.data || signal?.aborted || this.contextSessionID !== sessionID) return
        if (this.refreshes.get(sessionID) !== refresh) {
          if (this.revisions.get(sessionID) !== revision) this.refreshSessionDetails(sessionID, dir, signal)
          return
        }
        if (this.revisions.get(sessionID) !== revision) {
          this.refreshSessionDetails(sessionID, dir, signal)
          return
        }
        this.setCurrentSession(r.data)
        this.contextSessionID = r.data.id
        this.postMessage({ type: "sessionUpdated", session: this.sessionToWebview(r.data) })
        return r.data
      })
      .catch((e: unknown) => {
        console.warn("[CodeM] CodeMProvider: getSession failed (non-critical):", e)
        return undefined
      })
    this.postMessage({ type: "workspaceDirectoryChanged", directory: this.getWorkspaceDirectory(sessionID) })
    this.sync(sessionID, dir, signal, refresh)
    return details
  }

  private sync(sessionID: string, dir: string, signal?: AbortSignal, refresh?: number): void {
    const client = this.client
    if (!client) return
    const epoch = this.epoch
    const request = this.begin(dir)
    void client.session
      .status({ directory: dir })
      .then((result) => {
        if (!result.data || signal?.aborted || !this.latest(dir, request)) return
        if (refresh !== undefined && this.refreshes.get(sessionID) !== refresh) return
        for (const [sid, status] of Object.entries(result.data) as [string, SessionStatus][]) {
          if ((!this.trackedSessionIds.has(sid) && !this.owned(sid, dir)) || !this.accept(sid, status, dir, epoch))
            continue
          this.publish(sid, status)
        }
        for (const [sid, current] of this.sessionStatusMap) {
          if (result.data[sid] || current === "idle" || (!this.trackedSessionIds.has(sid) && !this.owned(sid, dir)))
            continue
          const status = { type: "idle" as const }
          if (this.accept(sid, status, dir, epoch)) this.publish(sid, status)
        }
      })
      .catch((error: unknown) => console.error("[CodeM] CodeMProvider: Failed to fetch session statuses:", error))
  }

  private fetchAndSendSessionModelUsage(sessionID: string, requestID: string): Promise<void> {
    const directory = this.getWorkspaceDirectory(sessionID)
    return this.connectionService
      .getClientAsync(directory)
      .then((client) => client.kilocode.sessionModelUsage({ sessionID, directory }, { throwOnError: true }))
      .then((response) => {
        this.modelUsageSessionIds = new Set(response.data.sessionIDs)
        this.postMessage({ type: "sessionModelUsageLoaded", sessionID, requestID, data: response.data })
      })
      .catch((error: unknown) => {
        console.warn("[CodeM] CodeMProvider: Failed to load session model usage:", error)
        this.postMessage({ type: "sessionModelUsageLoaded", sessionID, requestID })
      })
  }

  private async handleLoadMessages(
    sessionID: string,
    options: {
      mode?: MessageLoadMode
      focus?: boolean
      before?: string
      limit?: number
      preserveStream?: boolean
    } = {},
  ): Promise<void> {
    const mode = options.mode ?? "replace"
    if (mode === "replace" || mode === "focus") {
      this.trackedSessionIds.add(sessionID)
      if (options.focus !== false) {
        this.stopCurrentSessionProcesses(sessionID)
        this.focusSession(sessionID)
        this.contextSessionID = sessionID
      }
    }
    if (!this.client) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend", sessionID })
      return
    }
    const dir = this.getWorkspaceDirectory(sessionID)
    if (mode === "focus") {
      this.refreshSessionDetails(sessionID, dir)
      // Reconcile tail so SSE drops self-heal. Throttled to skip rapid tab-switching bursts.
      if (Date.now() - (this.lastReconciledAt.get(sessionID) ?? 0) < 1000) return
      await this.handleLoadMessages(sessionID, { mode: "reconcile", limit: options.limit ?? MESSAGE_PAGE_LIMIT })
      return
    }
    // Replace competes for the spinner and cancels earlier loads; prepend/reconcile run in parallel.
    const abort = mode === "replace" && options.focus !== false ? new AbortController() : undefined
    if (abort) {
      this.loadMessagesAbort?.abort()
      this.loadMessagesAbort = abort
    }
    const revision = this.revisions.get(sessionID)
    const details = abort ? this.refreshSessionDetails(sessionID, dir, abort.signal) : undefined
    const since = mode === "reconcile" ? Date.now() : undefined
    try {
      const page = await fetchMessagePage(this.client, {
        sessionID,
        workspaceDir: dir,
        limit: options.limit ?? MESSAGE_PAGE_LIMIT,
        before: options.before,
        signal: abort?.signal,
        tail:
          details &&
          (async () => {
            const session = await details
            return !!session && !session.revert && this.revisions.get(sessionID) === revision
          }),
      })
      if (abort?.signal.aborted) return
      // Drop results for a session deleted mid-fetch. Prepend/reconcile have
      // no abort controller, so this guard prevents ghost entries.
      if (!this.trackedSessionIds.has(sessionID)) return
      const messages = page.items.map((m) => ({
        ...this.slimInfo(m.info),
        parts: this.slimParts(m.parts),
        createdAt: new Date(m.info.time.created).toISOString(),
      }))
      if (mode === "replace" || mode === "reconcile") {
        void this.recoverSessionGitStatus(
          page.items.flatMap((message) => message.parts),
          sessionID,
          page.cursor,
        )
      }
      for (const message of messages) {
        this.connectionService.recordMessageSessionId(message.id, message.sessionID)
      }
      if (mode === "replace" || mode === "reconcile") this.resetMessageCosts(sessionID, messages)
      // Authoritative snapshots normally supersede buffered deltas. A newly
      // opened sub-agent viewer has no earlier renderer state, so its buffered
      // updates arrived during this fetch and must follow the snapshot.
      if ((mode === "replace" || mode === "reconcile") && !options.preserveStream) this.streams.drop(sessionID)
      if (mode === "reconcile") this.lastReconciledAt.set(sessionID, Date.now())
      this.postMessage({
        type: "messagesLoaded",
        sessionID,
        messages,
        mode,
        cursor: page.cursor,
        hasMore: Boolean(page.cursor),
        since,
      })
      if (options.preserveStream) this.streams.flush(sessionID)
      // Recover any prompts missed while the webview was loading or during an SSE reconnection.
      this.recoverPendingPrompts()
    } catch (error) {
      if (abort?.signal.aborted) return
      console.error("[CodeM] CodeMProvider: Failed to load messages:", error)
      this.postMessage({ type: "error", message: getErrorMessage(error) || "Failed to load messages", sessionID })
    }
  }

  /**
   * Handle syncing a child session (e.g. spawned by the task tool).
   * Tracks the session for SSE events and fetches its messages.
   */
  private async handleSyncSession(sessionID: string, parentSessionID?: string): Promise<void> {
    if (!this.client) return
    if (this.syncedChildSessions.has(sessionID)) return

    this.syncedChildSessions.add(sessionID)
    this.trackedSessionIds.add(sessionID)

    // Inherit the parent's worktree directory so permission responses use
    // the correct backend Instance. Without this, child sessions in Agent
    // Manager worktrees fall back to workspace root and fail to find the
    // pending permission request.
    if (!this.sessionDirectories.has(sessionID) && parentSessionID) {
      const dir = this.sessionDirectories.get(parentSessionID)
      if (dir) {
        this.sessionDirectories.set(sessionID, dir)
      }
      const git = this.sessionGitDirectories.get(parentSessionID)
      if (git) this.sessionGitDirectories.set(sessionID, git)
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      const project = this.opts.projectQualifier?.()
      if (project && this.opts.routeService) {
        this.owners.set(sessionID, { dir: workspaceDir, project: project.projectId })
      }
      const [info, history] = await Promise.all([
        retry(() => this.client!.session.get({ sessionID, directory: workspaceDir }, { throwOnError: true })),
        retry(() => this.client!.session.messages({ sessionID, directory: workspaceDir }, { throwOnError: true })),
      ])
      this.postMessage({ type: "sessionUpdated", session: this.sessionToWebview(info.data) })

      const messages = history.data.map((m) => ({
        ...this.slimInfo(m.info),
        parts: this.slimParts(m.parts),
        createdAt: new Date(m.info.time.created).toISOString(),
      }))

      for (const message of messages) {
        this.connectionService.recordMessageSessionId(message.id, message.sessionID)
      }
      this.resetMessageCosts(sessionID, messages)

      // Snapshot supersedes any queued deltas (see handleLoadMessages for the
      // snapshot-freshness assumption that governs drop() here).
      this.streams.drop(sessionID)
      this.postMessage({
        type: "messagesLoaded",
        sessionID,
        messages,
        mode: "replace",
        hasMore: false,
      })

      // Recover any prompts emitted by the child before we started tracking it.
      this.recoverPendingPrompts()
    } catch (err) {
      this.syncedChildSessions.delete(sessionID)
      console.error("[CodeM] CodeMProvider: Failed to sync child session:", err)
    }
  }

  private releaseChildSession(sessionID: string): void {
    if (
      this.inspectorSessionIds.has(sessionID) ||
      this.visibleTaskStreams.has(sessionID) ||
      this.currentSession?.id === sessionID ||
      this.openSessionIds.has(sessionID)
    ) {
      return
    }
    if (!this.syncedChildSessions.delete(sessionID)) return
    const status = this.sessionStatusMap.get(sessionID)
    if (status !== "busy" && status !== "retry") this.owners.delete(sessionID)
    this.trackedSessionIds.delete(sessionID)
    this.streams.drop(sessionID)
    this.visibleTaskStreams.delete(sessionID)
    this.sessionDirectories.delete(sessionID)
    this.sessionGitDirectories.delete(sessionID)
    this.sessionGitRecoveries.delete(sessionID)
    this.connectionService.pruneSession(sessionID)
  }

  /**
   * Build the context object used by the extracted session-refresh helpers.
   */
  private getSessionRefreshContext(revision: number): SessionRefreshContext {
    const client = this.client
    return {
      pendingSessionRefresh: this.pendingSessionRefresh,
      connectionState: this.connectionState,
      listSessions: client
        ? (dir: string) =>
            client.session.list({ directory: dir, roots: true }, { throwOnError: true }).then(({ data }) => data)
        : null,
      sessionDirectories: this.sessionDirectories,
      worktreeDirectories: this.opts.worktreeDirectories,
      workspaceDirectory: this.getWorkspaceDirectory(),
      isCurrent: () => revision === this.sessionRefreshRevision,
      postMessage: (msg: unknown) => this.postMessage(msg),
    }
  }

  /**
   * Retry a deferred sessions refresh once the client is ready.
   */
  private async flushPendingSessionRefresh(reason: string): Promise<void> {
    if (!this.pendingSessionRefresh) return
    console.log("[CodeM] CodeMProvider: 🔄 Flushing deferred sessions refresh", { reason })
    const revision = ++this.sessionRefreshRevision
    const scope = this.opts.projectQualifier?.()?.projectId
    if (scope !== undefined) this.projectID = undefined
    const ctx = this.getSessionRefreshContext(revision)
    try {
      const resolved = await flushPendingSessionRefreshUtil(ctx)
      if (resolved && scope === this.opts.projectQualifier?.()?.projectId) this.projectID = resolved
    } catch (error) {
      console.error("[CodeM] CodeMProvider: Failed to flush session refresh:", error)
    }
    this.pendingSessionRefresh = ctx.pendingSessionRefresh
  }

  /**
   * Handle loading all sessions.
   */
  private async handleLoadSessions(): Promise<void> {
    const revision = ++this.sessionRefreshRevision
    const scope = this.opts.projectQualifier?.()?.projectId
    if (scope !== undefined) this.projectID = undefined
    const ctx = this.getSessionRefreshContext(revision)
    try {
      const resolved = await loadSessionsUtil(ctx)
      if (resolved && scope === this.opts.projectQualifier?.()?.projectId) this.projectID = resolved
    } catch (error) {
      console.error("[CodeM] CodeMProvider: Failed to load sessions:", error)
      this.postMessage({
        type: "error",
        message: getErrorMessage(error) || "Failed to load sessions",
      })
    }
    this.pendingSessionRefresh = ctx.pendingSessionRefresh
  }

  private async handleContextRequest(message: ContextRequestMessage): Promise<void> {
    if (message.type === "requestFileSearch") {
      await handleFileSearch({
        client: this.client,
        message,
        current: this.currentSession?.id,
        context: this.contextSessionID,
        dir: (id) => this.getWorkspaceDirectory(id),
        open: (dir) => this.getOpenTabPaths(dir),
        post: (msg) => this.postMessage(msg),
      })
      return
    }
    if (message.type === "requestSessionSearch") {
      await handleSessionSearch({
        client: this.client,
        message,
        current: this.currentSession?.id,
        context: this.contextSessionID,
        dir: (id) => this.getWorkspaceDirectory(id),
        exclude: this.currentSession?.id,
        post: (msg) => this.postMessage(msg),
      })
      return
    }
    if (message.type === "requestFilePicker") {
      await handleFilePicker({ requestId: message.requestId, post: (msg) => this.postMessage(msg) })
      return
    }
    if (message.type === "requestTerminalContext") {
      void this.handleTerminalContext(message.requestId)
    }
  }

  private async handleTerminalContext(requestId: string): Promise<void> {
    try {
      const output = await getTerminalContents(-1)
      this.postMessage({
        type: "terminalContextResult",
        requestId,
        content: output.content,
        truncated: output.truncated,
      })
    } catch (error) {
      console.error("[CodeM] Failed to capture terminal context:", error)
      this.postMessage({
        type: "terminalContextError",
        requestId,
        error: getErrorMessage(error) || "Failed to capture terminal output",
      })
    }
  }

  /**
   * Drops every per-session cache entry we hold for the given id. Shared between
   * the user-initiated delete path (handleDeleteSession, after the backend
   * confirms) and the SSE session.deleted path (cascaded child deletes and
   * external CLI/TUI deletes that arrive via the event stream), so both paths
   * leave trackedSessionIds, sessionDirectories, and the related Maps in the
   * same state — including currentSession / contextSessionID / focused-session
   * registration. Without clearing those three, resolveSession() would still
   * see the deleted id via this.currentSession and the next send would target
   * a session the backend has already deleted.
   */
  private pruneDeletedSession(sessionID: string): void {
    this.removedSessionIds.add(sessionID)
    this.trackedSessionIds.delete(sessionID)
    this.openSessionIds.delete(sessionID)
    for (const [key, session] of this.draftSessions) {
      if (session.sid === sessionID) this.draftSessions.delete(key)
    }
    this.streams.drop(sessionID)
    this.visibleTaskStreams.delete(sessionID)
    this.syncedChildSessions.delete(sessionID)
    this.inspectorSessionIds.delete(sessionID)
    this.sessionDirectories.delete(sessionID)
    this.owners.delete(sessionID)
    this.sessionGitDirectories.delete(sessionID)
    this.sessionGitRecoveries.delete(sessionID)
    this.aborts.delete(sessionID)
    this.lastReconciledAt.delete(sessionID)
    this.checkpoints.delete(sessionID)
    this.revisions.delete(sessionID)
    this.refreshes.delete(sessionID)
    this.epochs.delete(sessionID)
    this.sessionStatusMap.delete(sessionID)
    this.costs.onSessionDeleted(sessionID)
    const deletedAlertLimit = this.activeAlerts.get(sessionID)
    if (deletedAlertLimit !== undefined) {
      this.activeAlerts.delete(sessionID)
      this.postMessage({ type: "sessionCostAlertResolved", sessionID: sessionID, limit: deletedAlertLimit })
    }
    this.connectionService.clearPermissionSession(sessionID)
    this.connectionService.pruneSession(sessionID)
    if (this.currentSession?.id === sessionID) {
      this.contextSessionID = undefined
      this.setCurrentSession(null)
    }
    if (this.streams.focused === sessionID) this.focusSession(undefined)
  }

  /**
   * Handle deleting a session.
   */
  private async handleDeleteSession(sessionID: string): Promise<void> {
    if (!this.client) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }

    try {
      const workspaceDir = this.getSessionDirectory(
        sessionID,
        this.currentSession?.id === sessionID ? this.currentSession : undefined,
      )
      await stopSessionProcesses(this.client, sessionID, workspaceDir)
      await this.client.session.delete({ sessionID, directory: workspaceDir }, { throwOnError: true })
      this.pruneDeletedSession(sessionID)
      if (this.currentSession?.id === sessionID) {
        this.contextSessionID = undefined
        this.setCurrentSession(null)
        this.focusSession(undefined)
      }
      this.postMessage({ type: "sessionDeleted", sessionID })
    } catch (error) {
      console.error("[CodeM] CodeMProvider: Failed to delete session:", error)
      this.postMessage({
        type: "error",
        message: getErrorMessage(error) || "Failed to delete session",
      })
    }
  }


  /**
   * Handle renaming a session.
   */
  private async handleRenameSession(sessionID: string, title: string): Promise<void> {
    try {
      const updated = await renameSession({
        client: this.client,
        sessionID,
        title,
        directory: this.getWorkspaceDirectory(sessionID),
      })
      if (this.currentSession?.id === sessionID) this.setCurrentSession(updated)
      this.postMessage({ type: "sessionUpdated", session: this.sessionToWebview(updated) })
    } catch (error) {
      console.error("[CodeM] CodeMProvider: Failed to rename session:", error)
      this.postMessage({ type: "error", message: getErrorMessage(error) || "Failed to rename session" })
    }
  }

  /**
   * Export a full session transcript as Markdown.
   */
  private async handleExportSessionTranscript(sessionID: string): Promise<void> {
    if (!this.client) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }

    try {
      const saved = await exportTranscript(this.client, {
        sessionID,
        dir: this.getWorkspaceDirectory(sessionID),
      })
      if (saved) void vscode.window.showInformationMessage("Session transcript exported as Markdown.")
    } catch (error) {
      console.error("[CodeM] CodeMProvider: Failed to export session transcript:", error)
      this.postMessage({
        type: "error",
        message: getErrorMessage(error) || "Failed to export session transcript",
      })
    }
  }

  private async fetchAndSendProviderUsage(force = false): Promise<void> {
    const generation = ++this.providerUsageGeneration
    const client = this.client
    if (!client) {
      this.postMessage(
        this.cachedProviderUsageMessage ?? {
          type: "providerUsageLoaded",
          error: "Provider usage could not be loaded.",
        },
      )
      return
    }

    const directory = this.getProjectDirectory(this.currentSession?.id)
    const result = await (
      force ? client.kilocode.providerUsage.refresh({ directory }) : client.kilocode.providerUsage.get({ directory })
    ).catch((error) => {
      console.error("[CodeM] CodeMProvider: Failed to fetch provider usage:", error)
      return undefined
    })
    if (generation !== this.providerUsageGeneration) return
    if (!result?.data) {
      if (this.cachedProviderUsageMessage) {
        this.postMessage(
          force
            ? { ...this.cachedProviderUsageMessage, error: "Provider usage could not be refreshed." }
            : this.cachedProviderUsageMessage,
        )
        return
      }
      this.postMessage({ type: "providerUsageLoaded", error: "Provider usage could not be loaded." })
      return
    }

    const message = { type: "providerUsageLoaded" as const, data: result.data }
    this.cachedProviderUsageMessage = message
    this.postMessage(message)
  }

  private invalidateProviders(): void {
    this.providersGeneration++
    this.cachedProvidersMessage = null
    this.postMessage({ type: "providersLoading" })
  }

  /** Fetch providers and send to webview. Coalesced: at most one in-flight + one queued. */
  private async fetchAndSendProviders(): Promise<void> {
    if (this.appServerController) {
      await this.appServerController.handle({ type: "requestProviders" })
      return
    }
    const next = ++this.providersGeneration
    if (this.providersRefresh) {
      this.providersQueued = true
      await this.providersRefresh
      return
    }
    const task = (async () => {
      let generation = next
      while (true) {
        this.providersQueued = false
        const client = this.client
        if (!client) {
          if (this.cachedProvidersMessage && generation === this.providersGeneration)
            this.postMessage(this.cachedProvidersMessage)
          return
        }
        try {
          const { response, authMethods, authStates, organizationId, ready } = await fetchProviderData(
            client,
            this.getWorkspaceDirectory(),
          )
          if (generation !== this.providersGeneration || client !== this.client) {
            if (!this.providersQueued) return
            generation = this.providersGeneration
            continue
          }
          const settings = vscode.workspace.getConfiguration("codem.model")
          const message = {
            type: "providersLoaded",
            providers: indexProvidersById(response.all),
            connected: response.connected,
            defaults: response.default,
            organizationId,
            ready,
            defaultSelection: computeDefaultSelection(
              null,
              settings.get<string>("providerID", ""),
              settings.get<string>("modelID", ""),
            ),
            authMethods,
            authStates,
          }
          this.cachedProvidersMessage = message
          this.postMessage(message)
        } catch (error) {
          if (generation !== this.providersGeneration) {
            if (!this.providersQueued) return
            generation = this.providersGeneration
            continue
          }
          console.error("[CodeM] CodeMProvider: Failed to fetch providers:", error)
        }
        if (!this.providersQueued) return
        generation = this.providersGeneration
      }
    })()
    const done = task.finally(() => {
      if (this.providersRefresh === done) this.providersRefresh = null
    })
    this.providersRefresh = done
    await done
  }

  private async fetchAndSendSkills(): Promise<void> {
    if (this.appServerController) {
      await this.appServerController.handle({ type: "requestSkills" })
      return
    }
    if (!this.client) {
      if (this.cachedSkillsMessage) {
        this.postMessage(this.cachedSkillsMessage)
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const { data: skills } = await retry(() =>
        this.client!.app.skills({ directory: workspaceDir }, { throwOnError: true }),
      )

      const message = {
        type: "skillsLoaded",
        skills,
      }
      this.cachedSkillsMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[CodeM] CodeMProvider: Failed to fetch skills:", error)
    }
  }

  /** 模型 / Skills / 斜杠目录走 App Server 原生 DTO；无控制器时才退回 Kilo 测试夹具。 */
  private async refreshLiveCatalogs(): Promise<void> {
    if (this.appServerController) {
      await Promise.all([
        this.appServerController.handle({ type: "requestProviders" }),
        this.appServerController.handle({ type: "requestSkills" }),
      ])
      return
    }
    await Promise.all([this.fetchAndSendProviders(), this.fetchAndSendSkills()])
  }

  private handleBoardMessage(message: Record<string, unknown>): Promise<boolean> {
    return Board.handle(message, {
      client: this.connectionState === "connected" ? this.client : null,
      routes: this.opts.routeService,
      projectId: this.opts.projectQualifier?.()?.projectId,
      directories: this.sessionDirectories,
      session: this.currentSession,
      post: (msg) => this.postMessage(msg),
    })
  }

  private async fetchAndSendBackgroundJobs(sessionID: string, requestID: string): Promise<void> {
    const client = this.client
    if (!client || this.connectionState !== "connected") {
      this.postMessage({ type: "backgroundJobsLoaded", sessionID, requestID, jobs: [], error: "Not connected" })
      return
    }
    try {
      const { data } = await client.kilocode.backgroundJobs(
        { directory: this.getWorkspaceDirectory(sessionID), sessionID },
        { throwOnError: true },
      )
      this.postMessage({ type: "backgroundJobsLoaded", sessionID, requestID, jobs: data })
    } catch (error) {
      console.error("[CodeM] CodeMProvider: Failed to fetch background jobs:", error)
      this.postMessage({
        type: "backgroundJobsLoaded",
        sessionID,
        requestID,
        jobs: [],
        error: getErrorMessage(error) || "Failed to fetch background jobs",
      })
    }
  }

  private async cancelBackgroundJob(jobID: string, sessionID: string, requestID: string): Promise<void> {
    const client = this.client
    if (!client || this.connectionState !== "connected") {
      this.postMessage({ type: "backgroundJobsLoaded", sessionID, requestID, jobs: [], error: "Not connected" })
      return
    }
    try {
      await client.kilocode.backgroundJob.cancel(
        { jobID, directory: this.getWorkspaceDirectory(sessionID) },
        { throwOnError: true },
      )
      await this.fetchAndSendBackgroundJobs(sessionID, requestID)
    } catch (error) {
      console.error("[CodeM] CodeMProvider: Failed to cancel background job:", error)
      this.postMessage({
        type: "backgroundJobsLoaded",
        sessionID,
        requestID,
        jobs: [],
        error: getErrorMessage(error) || "Failed to cancel background job",
      })
    }
  }


  private begin(dir: string): number {
    const key = [...this.requests.keys()].find((entry) => sameDirectory(entry, dir)) ?? dir
    const request = (this.requests.get(key) ?? 0) + 1
    this.requests.set(key, request)
    return request
  }

  private latest(dir: string, request: number): boolean {
    return [...this.requests].some(([entry, value]) => value === request && sameDirectory(entry, dir))
  }

  private mark(sessionID: string, dir?: string): void {
    const entries = this.epochs.get(sessionID) ?? new Map<string, number>()
    const key = dir ? ([...entries.keys()].find((entry) => entry && sameDirectory(entry, dir)) ?? dir) : ""
    entries.set(key, ++this.epoch)
    this.epochs.set(sessionID, entries)
  }

  private stale(sessionID: string, dir: string, epoch: number): boolean {
    const entries = this.epochs.get(sessionID)
    if (!entries) return false
    return [...entries].some(([entry, value]) => value > epoch && (!entry || sameDirectory(entry, dir)))
  }

  private accept(sessionID: string, status: SessionStatus, dir: string, epoch: number): boolean {
    if (this.stale(sessionID, dir, epoch)) return false
    const owner = this.owners.get(sessionID)?.dir ?? this.getWorkspaceDirectory(sessionID)
    if (status.type === "idle" && !sameDirectory(owner, dir)) return false
    this.mark(sessionID, dir)
    this.aborts.observe(sessionID, status.type, dir)
    return true
  }

  private publish(sessionID: string, status: SessionStatus): void {
    const previous = this.sessionStatusMap.get(sessionID)
    if ((previous === undefined || previous === "idle") && status.type !== "idle") this.costs.rearm(sessionID)
    this.sessionStatusMap.set(sessionID, status.type)
    if ((status.type === "idle" || status.type === "offline") && !this.syncedChildSessions.has(sessionID)) {
      this.owners.delete(sessionID)
    }
    this.streams.flush(sessionID)
    this.postMessage({
      type: "sessionStatus",
      sessionID,
      status: status.type,
      ...(status.type === "retry" ? { attempt: status.attempt, message: status.message, next: status.next } : {}),
      ...(status.type === "offline" ? { message: status.message } : {}),
    })
  }

  private async seedSessionStatusMap(reconcile = true): Promise<void> {
    if (!this.client || this.connectionState !== "connected") return
    const dir = this.getWorkspaceDirectory()
    const epoch = this.epoch
    const request = this.begin(dir)
    await seedSessionStatuses(
      this.client,
      dir,
      this.sessionStatusMap,
      (message) => this.postMessage(message),
      reconcile,
      (sessionID, status) => this.latest(dir, request) && this.accept(sessionID, status, dir, epoch),
    )
  }


  /**
   * Fetch config warnings from the server and display a single consolidated
   * VS Code warning with a "Show Details" action button.
   * Only shown once per provider lifecycle (flag resets on dispose/re-create, not on SSE reconnect).
   */
  private async checkConfigWarnings(from: string): Promise<void> {
    if (this.configWarningsShown) {
      console.log("[CodeM] CodeMProvider: config warnings already shown", { from })
      return
    }
    if (!this.client) {
      console.log("[CodeM] CodeMProvider: config warnings skipped (no client)", { from })
      return
    }
    try {
      const dir = this.getWorkspaceDirectory()
      console.log("[CodeM] CodeMProvider: checking config warnings", { from, dir })
      const result = await this.client.config.warnings({ directory: dir })
      const list = result?.data ?? []
      console.log("[CodeM] CodeMProvider: config warnings fetched", { from, count: list.length })
      if (list.length === 0) return
      this.configWarningsShown = true

      const first = list[0]!
      const summary = list.length === 1 ? first.message : `${first.message} (and ${list.length - 1} more)`
      console.warn("[CodeM] CodeMProvider: showing config warnings", { from, count: list.length, path: first.path })

      const action = await vscode.window.showWarningMessage(`Config: ${summary}`, "Show Details")
      if (action === "Show Details") {
        const lines = list.map((w) => {
          const base = `${w.path}\n  ${w.message}`
          return w.detail ? `${base}\n  ${w.detail}` : base
        })
        const channel = vscode.window.createOutputChannel("CodeM Config Warnings")
        channel.clear()
        channel.appendLine(lines.join("\n\n"))
        channel.show()
      }
    } catch (err) {
      console.warn("[CodeM] CodeMProvider: checkConfigWarnings failed:", { from, err })
    }
  }

  private notificationsContext(): NotificationsContext {
    return {
      context: this.extensionContext,
      client: this.client,
      cached: () => this.cachedNotificationsMessage,
      set: (message) => {
        this.cachedNotificationsMessage = message
      },
      post: (message) => this.postMessage(message),
      notify: (id) => this.connectionService.notifyNotificationDismissed(id),
    }
  }

  private async fetchAndSendNotifications(): Promise<void> {
    await fetchNotifications(this.notificationsContext())
  }

  // Cloud session methods extracted to host/handlers/cloud-session.ts

  private async handleDismissNotification(notificationId: string): Promise<void> {
    await dismissNotification(this.notificationsContext(), notificationId)
  }

  /** Read attention settings from VS Code config and push to webview. */
  private sendNotificationSettings(): void {
    const attention = vscode.workspace.getConfiguration("codem.attention")
    this.postMessage({
      type: "notificationSettingsLoaded",
      settings: {
        attentionEnabled: attention.get<boolean>("enabled", false),
        attentionNotifications: attention.get<boolean>("notifications", false),
        attentionOSNotifications: attention.get<boolean>("OSNotifications", false),
        attentionSound: attention.get<string>("sound", "default"),
        osNotificationsAvailable: ["win32", "darwin", "linux"].includes(process.platform),
      },
    })
  }

  private async handleTestOSNotification(): Promise<void> {
    const result = await testOSNotification()
    this.postMessage({ type: "osNotificationTestResult", ...result })
  }

  private sendTimelineSetting(): void {
    this.postMessage(buildTimelineSettingMessage())
  }

  private sendWorkStyle(): void {
    this.postMessage(getWorkStylePayload())
  }

  private async resolveSession(sessionID?: string, draftID?: string, context?: string, contextDirectory?: string) {
    if (!this.client) return undefined

    // Agent Manager: consult the shared route service for an exact directory
    // before the legacy sessionDirectories/workspace-root resolution. When a
    // raw session id is ambiguous across projects, refuse to resolve rather
    // than fall back to the active root or a stale single-entry map — share,
    // unshare, send, and other command paths route through here. A project
    // qualifier (when configured) disambiguates to the exact directory.
    let routedDir: string | null | undefined = undefined
    if (sessionID) {
      routedDir = this.routeSessionDirectory(sessionID)
      if (routedDir === null) {
        throw new Error(
          `Session ${sessionID} is ambiguous across projects; cannot resolve a directory without a project qualifier.`,
        )
      }
    }

    const dir =
      routedDir ??
      resolveNewSessionDirectory({
        sessionID,
        currentSessionID: this.currentSession?.id,
        contextSessionID: this.contextSessionID,
        agentManagerContext: context,
        contextDirectory,
        sessionDirectories: this.sessionDirectories,
        workspaceDirectory: this.getRootDirectory(),
      })

    const key = `${draftID ?? context ?? "new"}\0${dir}`
    const now = Date.now()
    for (const [draft, session] of this.draftSessions) {
      if (session.expires <= now) this.draftSessions.delete(draft)
    }
    if (!sessionID && draftID) {
      const resolved = this.draftSessions.get(key)
      if (resolved) {
        this.trackedSessionIds.add(resolved.sid)
        return { sid: resolved.sid, dir: resolved.dir }
      }
    }

    if (!sessionID && (draftID || !this.currentSession)) {
      const pending = this.sessionCreations.get(key)
      if (pending) return pending
      if (draftID) this.creatingDrafts.add(draftID)
      const creation = (async () => {
        const metadata = await sandboxSessionMetadata(this.connectionService.sandboxPreference, this.client!, dir)
        const { data: session } = await this.client!.session.create(
          { directory: dir, platform: this.opts.platform, metadata },
          { throwOnError: true },
        )
        if (draftID && this.closedDrafts.delete(draftID)) {
          await this.client!.session.delete({ sessionID: session.id, directory: dir }, { throwOnError: true })
          return undefined
        }
        this.stopCurrentSessionProcesses(session.id)
        this.setCurrentSession(session)
        this.contextSessionID = session.id
        this.focusSession(session.id)
        this.trackDirectory(session.id, dir)
        this.trackedSessionIds.add(session.id)
        this.postMessage({
          type: "sessionCreated",
          projectId: this.opts.projectQualifier?.()?.projectId,
          session: this.sessionToWebview(session),
          draftID,
        })
        const resolved = { sid: session.id, dir }
        if (draftID) this.draftSessions.set(key, { ...resolved, expires: Date.now() + 60_000 })
        return resolved
      })().finally(() => {
        this.sessionCreations.delete(key)
        if (draftID) this.creatingDrafts.delete(draftID)
      })
      this.sessionCreations.set(key, creation)
      return creation
    }

    const sid = sessionID || this.currentSession?.id
    if (!sid) throw new Error("No session available")
    this.trackedSessionIds.add(sid)
    return { sid, dir }
  }

  /** Drafts closed while their backend session is being created or submitted. */
  private closedDrafts = new Set<string>()
  private creatingDrafts = new Set<string>()

  /** Abort controllers for active retry loops, keyed by session ID */
  private retryAbortControllers = new Map<string, AbortController>()

  /** Execute an SDK call with visible exponential backoff for retryable HTTP errors. */
  private async withRetry(
    fn: () => Promise<{ error?: unknown; response?: Response }>,
    sid: string,
    messageID?: string,
  ): Promise<void> {
    const abortController = new AbortController()
    this.retryAbortControllers.set(sid, abortController)

    try {
      for (let attempt = 1; ; attempt++) {
        if (abortController.signal.aborted) {
          // User cancelled — return normally without triggering sendMessageFailed
          return
        }

        const result = await fn()
        if (!result.error) return
        if (this.confirmations.has(messageID)) return

        const status = result.response?.status ?? 0

        // Non-retryable status codes fail immediately without retry
        if (!retryable(status)) {
          this.postMessage({ type: "sessionStatus", sessionID: sid, status: "idle" })
          throw result.error
        }

        // Stop retrying after MAX_RETRIES attempts
        if (attempt >= MAX_RETRIES) {
          this.postMessage({ type: "sessionStatus", sessionID: sid, status: "idle" })
          throw result.error
        }

        const delay = backoff(attempt, result.response?.headers)
        console.log(`[CodeM] CodeMProvider: Retry on ${status}, attempt ${attempt}/${MAX_RETRIES}, delay ${delay}ms`)

        this.postMessage({
          type: "sessionStatus",
          sessionID: sid,
          status: "retry",
          attempt,
          message: `Error (${status}). Retrying...`,
          next: Date.now() + delay,
        })

        // Wait for delay or until aborted
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer)
            abortController.signal.removeEventListener("abort", done)
            resolve()
          }
          const timer = setTimeout(done, delay)
          abortController.signal.addEventListener("abort", done, { once: true })
        })
        if (this.confirmations.has(messageID)) return
      }
    } finally {
      this.retryAbortControllers.delete(sid)
    }
  }

  /** Cancel an active retry loop for a session */
  private cancelRetry(sid: string): void {
    const controller = this.retryAbortControllers.get(sid)
    if (controller) {
      controller.abort()
      this.postMessage({ type: "sessionStatus", sessionID: sid, status: "idle" })
    }
  }

  private maxCostSetting(): number {
    return this.setMaxCost(vscode.workspace.getConfiguration("codem").get<number>("maxCost", 0))
  }

  private commitMessageLanguageSetting(): string {
    return vscode.workspace.getConfiguration("codem").get<string>("languageCommitMessage", "sync")
  }

  private multiProjectSetting(): boolean {
    return vscode.workspace.getConfiguration("codem.experimental").get<boolean>("multiProject", false)
  }

  private claudeMigrationSetting(): boolean {
    return vscode.workspace.getConfiguration("codem.experimental").get<boolean>("claudeMigration", false)
  }
  private browserAutomationSetting(): boolean {
    return vscode.workspace.getConfiguration("codem.experimental").get<boolean>("browserAutomation", false)
  }


  private postPromptDefaults(): void {
    const configuration = vscode.workspace.getConfiguration("codem")
    const defaults: PromptDefaults = {
      intelligence: configuration.get("intelligence", DEFAULT_PROMPT_SETTINGS.intelligence),
      permissionMode: configuration.get("permissionMode", DEFAULT_PROMPT_SETTINGS.permissionMode),
    }
    this.postMessage({ type: "promptDefaults", defaults })
  }


  private async handleAgentManagerSettingsMessage(
    message: TypedWebviewMessage & { projectId?: string; branch?: string; requestId?: string },
  ): Promise<boolean> {
    const handler = this.opts.agentManagerSettings
    if (!handler) return false
    const requestId = message.requestId
    if (typeof requestId !== "string") return false
    // Only Agent Manager settings messages participate in the generation
    // guard: unrelated Settings-panel requests also carry requestId and must
    // not invalidate an in-flight projects/branches response.
    if (
      message.type !== "requestAgentManagerSettings" &&
      message.type !== "requestAgentManagerSettingsBranches" &&
      message.type !== "setAgentManagerDefaultBaseBranch" &&
      message.type !== "configureAgentManagerSetupScript"
    )
      return false
    // The settings handler is project-scoped by projectId; the panel's own
    // project directory (config bindings, saves, local-config opens) must
    // stay untouched so Agent Manager tab traffic cannot expire unsaved
    // config edits.
    const generation = ++this.settingsGeneration
    if (message.type === "requestAgentManagerSettings") {
      await this.sendAgentManagerSettings(message.projectId, false, generation, requestId)
      return true
    }
    if (message.type === "requestAgentManagerSettingsBranches" && message.projectId) {
      await this.sendAgentManagerSettingsBranches(message.projectId, generation, requestId)
      return true
    }
    if (message.type === "setAgentManagerDefaultBaseBranch" && message.projectId) {
      await handler.setDefaultBaseBranch(message.projectId, message.branch)
      if (this.settingsGeneration !== generation) return true
      await this.sendAgentManagerSettings(message.projectId, false, generation, requestId)
      return true
    }
    if (message.type === "configureAgentManagerSetupScript" && message.projectId) {
      await handler.configureSetupScript(message.projectId)
      if (this.settingsGeneration !== generation) return true
      await this.sendAgentManagerSettings(message.projectId, false, generation, requestId)
      return true
    }
    return false
  }

  private async sendAgentManagerSettings(
    projectId: string | undefined,
    withBranches: boolean,
    generation: number,
    requestId: string,
  ): Promise<void> {
    const handler = this.opts.agentManagerSettings
    if (!handler) return
    const projects = await handler.projects(projectId)
    if (this.settingsGeneration !== generation) return
    const selected = projects.some((project) => project.id === projectId) ? projectId : projects[0]?.id
    const branch = selected ? await handler.defaultBranch(selected) : undefined
    if (this.settingsGeneration !== generation) return
    const items = selected
      ? projects.map((project) => (project.id === selected ? { ...project, defaultBranch: branch } : project))
      : projects
    this.postMessage({ type: "agentManagerSettingsLoaded", projects: items, projectId: selected, requestId })
    if (withBranches && selected) await this.sendAgentManagerSettingsBranches(selected, generation, requestId)
  }

  private async sendAgentManagerSettingsBranches(
    projectId: string,
    generation: number,
    requestId: string,
  ): Promise<void> {
    const handler = this.opts.agentManagerSettings
    if (!handler) return
    const data = await handler.branches(projectId)
    if (this.settingsGeneration !== generation) return
    this.postMessage(
      data
        ? { type: "agentManagerSettingsBranchesLoaded", ...data, requestId }
        : {
            type: "agentManagerSettingsBranchesLoaded",
            projectId,
            branches: [],
            defaultBranch: "",
            requestId,
            error: true,
          },
    )
  }


  private setMaxCost(value: unknown): number {
    maxCost = MaxCostNudge.normalizeLimit(typeof value === "number" ? value : Number(value)) ?? 0
    this.costs.setLimit(maxCost)
    return maxCost
  }

  private costLimit(): number | undefined {
    const limit = maxCost
    this.costs.setLimit(limit)
    return this.costs.limit
  }

  private requestCostAlert(sid: string, cost: number): void {
    const limit = this.costLimit()
    if (limit === undefined || !Number.isFinite(cost) || cost < limit) return

    this.costs.setSessionCost(sid, cost)
    const alert = this.costs.check(sid)
    if (!alert) return
    this.activeAlerts.set(sid, alert.limit)
    this.postMessage({
      type: "sessionCostAlert",
      sessionID: sid,
      limit: alert.limit,
      cost: MaxCostNudge.formatCost(alert.cost),
    })
  }

  private async handleCostAlertResponse(sid: string, limit: number, response: MaxCostChoice): Promise<void> {
    this.activeAlerts.delete(sid)
    this.costs.resolve(sid, response, limit)
    if (response !== "continue") await this.handleAbort(sid)
    this.postMessage({ type: "sessionCostAlertResolved", sessionID: sid, limit })
  }

  private resetMessageCosts(
    sid: string,
    messages: Array<{ id: string; sessionID: string; role?: string; cost?: number }>,
  ) {
    const total = this.costs.resetMessageCosts(sid, messages)
    this.requestCostAlert(sid, total)
  }

  private updateMessageCost(
    sid: string,
    id: string,
    role: string | undefined,
    cost: number | undefined,
  ): number | undefined {
    if (role !== "assistant" || !Number.isFinite(cost)) return undefined
    return this.costs.updateMessageCost(sid, id, role, cost)
  }

  private removeMessageCost(id: string): void {
    this.costs.removeMessageCost(id)
  }

  private async handleSendMessage(
    text: string,
    messageID?: string,
    sessionID?: string,
    draftID?: string,
    providerID?: string,
    modelID?: string,
    agent?: string,
    variant?: string,
    files?: MessageFile[],
    review?: ReviewMessageData,
    context?: string,
    contextDirectory?: string,
    browserFeedback?: BrowserFeedbackData,
  ): Promise<void> {
    if (!this.client) {
      this.postMessage({
        type: "sendMessageFailed",
        error: "Not connected to CLI backend",
        text,
        sessionID,
        draftID,
        messageID,
        files,
        review,
        browserFeedback,
      })
      return
    }

    let resolved: { sid: string; dir: string } | undefined
    try {
      resolved = await this.resolveSession(sessionID, draftID, context, contextDirectory)
      if (!resolved) return
      const sid = resolved.sid
      const dir = resolved.dir

      const parts: Array<TextPartInput | FilePartInput> = []
      if (files) {
        for (const f of files) {
          parts.push({ type: "file", mime: f.mime, url: f.url, filename: f.filename, source: f.source })
        }
      }
      parts.push({ type: "text", text, metadata: feedbackMetadata(review, browserFeedback) })

      const editorContext = await this.gatherEditorContext(dir)
      if (draftID && this.closedDrafts.delete(draftID)) {
        for (const [k, v] of this.draftSessions) if (v.sid === sid) this.draftSessions.delete(k)
        return
      }

      if (messageID) {
        this.connectionService.recordMessageSessionId(messageID, sid)
      }

      await this.checkpoints.get(sid)
      await runWithMessageConfirmation(this.confirmations, messageID, "CodeMProvider: Message request", () =>
        this.withRetry(
          () =>
            this.client!.session.promptAsync({
              sessionID: sid,
              directory: dir,
              messageID,
              parts,
              model: providerID && modelID ? { providerID, modelID } : undefined,
              agent,
              variant,
              editorContext,
              snapshotInitialization: this.opts.snapshotInitialization,
            }),
          sid,
          messageID,
        ),
      )
    } catch (error) {
      console.error("[CodeM] CodeMProvider: Failed to send message:", error)
      this.postMessage({
        type: "sendMessageFailed",
        error: getErrorMessage(error) || "Failed to send message",
        text,
        sessionID: resolved?.sid ?? sessionID,
        draftID,
        messageID,
        files,
        review,
        browserFeedback,
      })
    }
  }

  private async handleSendCommand(
    command: string,
    args: string,
    messageID?: string,
    sessionID?: string,
    draftID?: string,
    providerID?: string,
    modelID?: string,
    agent?: string,
    variant?: string,
    files?: MessageFile[],
    context?: string,
    contextDirectory?: string,
  ): Promise<void> {
    if (!this.client) {
      this.postMessage({
        type: "sendMessageFailed",
        error: "Not connected to CLI backend",
        text: `/${command} ${args}`.trim(),
        sessionID,
        draftID,
        messageID,
        files,
      })
      return
    }

    let resolved: { sid: string; dir: string } | undefined
    try {
      resolved = await this.resolveSession(sessionID, draftID, context, contextDirectory)
      if (!resolved) return
      const control = goalControl(command, args)
      const sid = resolved.sid
      const dir = resolved.dir

      if (messageID) {
        this.connectionService.recordMessageSessionId(messageID, sid)
      }

      const parts = files?.map((f) => ({
        type: "file" as const,
        mime: f.mime,
        url: f.url,
        filename: f.filename,
        source: f.source,
      }))

      if (!control) await this.checkpoints.get(sid)
      const send = () =>
        this.client!.session.command({
          sessionID: sid,
          directory: dir,
          command,
          arguments: args,
          messageID,
          model: !control && providerID && modelID ? `${providerID}/${modelID}` : undefined,
          agent: control ? undefined : agent,
          variant: control ? undefined : variant,
          parts,
          snapshotInitialization: this.opts.snapshotInitialization,
        })
      await runWithMessageConfirmation(this.confirmations, messageID, "CodeMProvider: Command request", async () => {
        if (command !== "goal") return this.withRetry(send, sid, messageID)
        const result = await send()
        if (result.error) throw result.error
        if (args.trim()) return
        const message = result.data?.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
        if (message) void vscode.window.showInformationMessage(message)
      })
      if (messageID && completesWithoutStatus(command)) {
        this.postMessage({ type: "sessionCommandCompleted", messageID })
      }
    } catch (error) {
      console.error("[CodeM] CodeMProvider: Failed to send command:", error)
      this.postMessage({
        type: "sendMessageFailed",
        error: getErrorMessage(error) || "Failed to send command",
        text: `/${command} ${args}`.trim(),
        sessionID: resolved?.sid ?? sessionID,
        draftID,
        messageID,
        files,
      })
    }
  }

  public acknowledgeDraft(draftID: string, sessionID: string): void {
    for (const [k, v] of this.draftSessions) {
      if (v.sid === sessionID) {
        this.draftSessions.delete(k)
        break
      }
    }
    this.closedDrafts.delete(draftID)
  }

  public async abortSessions(ids: readonly string[]): Promise<void> {
    const sessions = [...new Set(ids)]
    const targets = new Set(sessions.filter((sid) => !sid.startsWith("pending:")))
    for (const draft of sessions.filter((sid) => sid.startsWith("pending:"))) {
      let sid: string | undefined
      for (const [k, v] of this.draftSessions) {
        if (k.startsWith(`${draft}\0`)) {
          sid = v.sid
          break
        }
      }
      if (!sid && !this.creatingDrafts.has(draft)) continue
      this.closedDrafts.add(draft)
      if (sid) targets.add(sid)
    }
    await Promise.all([...targets].map((sid) => this.stopSession(sid)))
  }

  private stopSession(sid: string, scope?: "session" | "tree"): Promise<boolean> {
    this.cancelRetry(sid)
    const client = this.client
    if (!client) return Promise.resolve(false)
    const dir = this.getWorkspaceDirectory(sid)
    this.aborts.preserve(sid, this.sessionStatusMap.get(sid), dir)
    return this.aborts.stop(
      client,
      sid,
      dir,
      (dir, action) => this.connectionService.runExplicitAbort(sid, dir, action),
      scope,
    )
  }


  private async handleAbort(sessionID?: string, scope?: "session" | "tree"): Promise<void> {
    const sid = sessionID || this.currentSession?.id
    if (!sid || !(await this.stopSession(sid, scope))) return
    this.mark(sid)
    this.publish(sid, { type: "idle" })
  }


  /**
   * Handle compact (context summarization) request from the webview.
   */
  private async handleCompact(sessionID?: string, providerID?: string, modelID?: string): Promise<void> {
    if (!this.client) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    const target = sessionID || this.currentSession?.id
    if (!target) {
      console.error("[CodeM] CodeMProvider: No sessionID for compact")
      return
    }

    if (!providerID || !modelID) {
      console.error("[CodeM] CodeMProvider: No model selected for compact")
      this.postMessage({
        type: "error",
        message: "No model selected. Connect a provider to compact this session.",
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(target)
      await this.client.session.summarize(
        { sessionID: target, directory: workspaceDir, providerID, modelID },
        { throwOnError: true },
      )
    } catch (error) {
      console.error("[CodeM] CodeMProvider: Failed to compact session:", error)
      this.postMessage({
        type: "error",
        message: getErrorMessage(error) || "Failed to compact session",
      })
    }
  }

  // Permission + question handlers extracted to host/handlers/permission.ts and question.ts

  private get permissionCtx(): PermissionContext {
    return {
      client: this.client,
      currentSessionId: this.currentSession?.id,
      trackedSessionIds: this.trackedSessionIds,
      sessionDirectories: this.sessionDirectories,
      extraDirectories: this.opts.worktreeDirectories,
      postMessage: (msg) => this.postMessage(msg),
      getWorkspaceDirectory: (sid) => this.getWorkspaceDirectory(sid),
      recordPermissionDirectory: (id, dir, sid) => this.connectionService.recordPermissionDirectory(id, dir, sid),
      getPermissionDirectory: (id) => this.connectionService.getPermissionDirectory(id),
      getPermissionSession: (id) => this.connectionService.getPermissionSession(id),
      clearPermissionDirectory: (id) => this.connectionService.clearPermissionDirectory(id),
      getPermissionRevision: () => this.connectionService.getPermissionRevision(),
      prunePermissionDirectories: (active, dirs) => this.connectionService.prunePermissionDirectories(active, dirs),
      runPermissionResponse: (id, sid, action) => this.connectionService.runPermissionResponse(id, sid, action),
      isPermissionResponseClaimed: (id) => this.connectionService.isPermissionResponseClaimed(id),
      clearPermissionResponse: (id) => this.connectionService.clearPermissionResponse(id),
    }
  }

  private get questionCtx() {
    return {
      client: this.client,
      currentSessionId: this.currentSession?.id,
      trackedSessionIds: this.trackedSessionIds,
      sessionDirectories: this.sessionDirectories,
      extraDirectories: this.opts.worktreeDirectories,
      postMessage: (msg: unknown) => this.postMessage(msg),
      getWorkspaceDirectory: (sid?: string) => this.getWorkspaceDirectory(sid),
      recordQuestionDirectory: (id: string, dir: string) => this.connectionService.recordQuestionDirectory(id, dir),
      getQuestionDirectory: (id: string) => this.connectionService.getQuestionDirectory(id),
      clearQuestionDirectory: (id: string) => this.connectionService.clearQuestionDirectory(id),
      getQuestionRevision: () => this.connectionService.getQuestionRevision(),
      pruneQuestionDirectories: (active: Set<string>, dirs: Set<string>) =>
        this.connectionService.pruneQuestionDirectories(active, dirs),
    }
  }

  // Cloud session handlers extracted to host/handlers/cloud-session.ts

  private get cloudSessionCtx(): CloudSessionContext {
    const self = this
    return {
      client: this.client,
      get currentSession() {
        return self.currentSession
      },
      set currentSession(session) {
        self.stopCurrentSessionProcesses(session?.id)
        self.setCurrentSession(session)
        if (session) self.contextSessionID = session.id
      },
      trackedSessionIds: this.trackedSessionIds,
      connectionService: this.connectionService,
      postMessage: (msg) => this.postMessage(msg),
      notify: (message) => void vscode.window.showInformationMessage(message),
      getWorkspaceDirectory: (sid) => this.getWorkspaceDirectory(sid),
      gatherEditorContext: () => this.gatherEditorContext(),
      runWithMessageConfirmation: (id, label, run) => runWithMessageConfirmation(this.confirmations, id, label, run),
    }
  }

  // Auth handlers extracted to host/handlers/auth.ts

  private get authCtx(): AuthContext {
    return {
      client: this.client,
      postMessage: (msg) => this.postMessage(msg),
      getWorkspaceDirectory: () => this.getWorkspaceDirectory(),
      disposeGlobal: () => this.disposeGlobal(),
      invalidateProviderUsage: () => this.invalidateProviderUsage(),
      invalidateProviders: () => this.invalidateProviders(),
      fetchAndSendProviders: () => this.fetchAndSendProviders(),
    }
  }

  private invalidateProviderUsage(): void {
    this.providerUsageGeneration++
    this.cachedProviderUsageMessage = null
    this.postMessage({ type: "providerUsageLoaded", reset: true })
  }

  private async disposeGlobal(): Promise<void> {
    if (!this.client) return

    await this.client.global
      .dispose()
      .catch((e: unknown) => console.warn("[CodeM] CodeMProvider: global.dispose() after org switch failed:", e))

    // Org switch succeeded — refresh profile and providers independently (best-effort)
    try {
      const profileResult = await this.client!.kilo.profile()
      // Broadcast to all webviews (sidebar, profile tab, agent manager, etc.)
      this.connectionService.notifyProfileChanged(profileResult.data ?? null)
    } catch (error) {
      console.error("[CodeM] CodeMProvider: Failed to refresh profile after org switch:", error)
    }
    try {
      await this.fetchAndSendProviders()
    } catch (error) {
      console.error("[CodeM] CodeMProvider: Failed to refresh providers after org switch:", error)
    }
  }

  /**
   * Handle a generic setting update from the webview.
   */
  private async handleUpdateSetting(key: string, value: unknown): Promise<void> {
    if (key === "maxCost") {
      const normalized = this.setMaxCost(value)
      await vscode.workspace.getConfiguration("codem").update("maxCost", normalized, vscode.ConfigurationTarget.Global)
      for (const sid of this.trackedSessionIds) {
        const oldLimit = this.activeAlerts.get(sid)
        if (oldLimit !== undefined) {
          this.activeAlerts.delete(sid)
          this.postMessage({ type: "sessionCostAlertResolved", sessionID: sid, limit: oldLimit })
        }
        this.costs.rearm(sid)
        this.requestCostAlert(sid, this.costs.sessionCost(sid))
      }
      return
    }
    const { section, leaf } = buildSettingPath(key)
    if (section === "autocomplete" && !validAutocompleteSetting(leaf, value)) return
    if (section === "indexing") return
    if (section === "chat" && !validChatSetting(leaf, value)) return
    const config = vscode.workspace.getConfiguration(`codem${section ? `.${section}` : ""}`)
    // Normalize a webview-side clear to `undefined` so VS Code removes the
    // key from settings.json rather than persisting a literal `null`. This
    // lets the runtime fall back to the resolved default.
    const next = value === null ? undefined : value
    await config.update(leaf, next, vscode.ConfigurationTarget.Global)
    if (isWorkStyleSetting(key)) this.sendWorkStyle()
  }

  /**
   * Reset all "codem.*" extension settings to their defaults by reading
   * contributes.configuration from the extension's package.json at runtime.
   * Only resets settings under the current "codem." namespace.
   */
  private async handleResetAllSettings(): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      "Reset all CodeM extension settings to defaults?",
      { modal: true },
      "Reset",
    )
    if (confirmed !== "Reset") return

    const prefix = "codem."
    const ext = vscode.extensions.getExtension("codem.codem")
    const properties = ext?.packageJSON?.contributes?.configuration?.properties as Record<string, unknown> | undefined
    if (!properties) return

    for (const key of Object.keys(properties)) {
      if (!key.startsWith(prefix)) continue
      const parts = key.split(".")
      const section = parts.slice(0, -1).join(".")
      const leaf = parts[parts.length - 1]!
      const config = vscode.workspace.getConfiguration(section)
      await config.update(leaf, undefined, vscode.ConfigurationTarget.Global)
    }

    // Clear globalState items that are not part of the configuration
    await this.extensionContext?.globalState.update("variantSelections", undefined)
    await this.extensionContext?.globalState.update("recentModels", undefined)
    await this.extensionContext?.globalState.update("modelUsage", undefined)
    await this.extensionContext?.globalState.update("kilo.dismissedNotificationIds", undefined)
    await this.extensionContext?.globalState.update("kilo.agentMigrationBannerDismissed", undefined)
    await this.extensionContext?.globalState.update("kilo.marketplace.dismissedSuggestions", undefined)

    // Re-send all settings to the webview so the UI reflects the reset
    this.postMessage(buildAutocompleteSettingsMessage())
    this.sendBrowserSettings()
    this.sendNotificationSettings()
    this.sendTimelineSetting()
    this.postMessage(buildThroughputSettingMessage())
    this.postMessage(buildAutoApprovalReasonSettingMessage())
    this.postMessage(buildPushFixesSettingMessage())
    this.sendWorkStyle()
    await ModelState.reset(this.client, (msg) => this.postMessage(msg))

    // Re-send globalState items to the webview
    this.postMessage({ type: "variantsLoaded", variants: {} })
    this.postMessage({ type: "recentsLoaded", recents: [] })
    this.postMessage({ type: "modelUsageLoaded", usage: {} })

    // Re-fetch notifications to reflect cleared dismissed IDs
    await this.fetchAndSendNotifications()

    vscode.window.showInformationMessage("CodeM settings have been reset to defaults.")
  }

  /**
   * Read the current browser automation settings and push them to the webview.
   */
  private sendBrowserSettings(): void {
    const config = vscode.workspace.getConfiguration("codem.browserAutomation")
    this.postMessage({
      type: "browserSettingsLoaded",
      settings: {
        useSystemChrome: config.get<boolean>("useSystemChrome", true),
      },
    })
  }

  /**
   * Read the current Claude Code compatibility setting and push it to the webview.
   */
  private sendClaudeCompatSetting(): void {
    const enabled = vscode.workspace.getConfiguration("codem").get<boolean>("claudeCodeCompat", false)
    this.postMessage({
      type: "claudeCompatSettingLoaded",
      enabled: enabled ?? false,
    })
  }

  /** Re-fetch all server-side state after an auth change. */
  private async reloadAfterAuthChange(): Promise<void> {
    this.invalidateProviderUsage()
    this.invalidateProviders()
    await Promise.all([this.refreshLiveCatalogs(), this.fetchAndSendNotifications()])
  }

  /** Reload config, skills, agents, and commands from disk by rebooting the instance. */
  private async handleReload(): Promise<void> {
    if (!this.client) {
      console.warn("[CodeM] handleReload: no client connection")
      return
    }
    const dir = this.getWorkspaceDirectory(this.currentSession?.id)
    try {
      await this.client.instance.reload({ directory: dir }, { throwOnError: true })
    } catch (err) {
      // wrapClientError exposes the HTTP status via `cause`, not `response`.
      const cause = err instanceof Error ? err.cause : undefined
      const status =
        cause && typeof cause === "object" && "status" in cause ? (cause as { status?: number }).status : undefined
      if (status === 409) {
        vscode.window.showWarningMessage(
          "Cannot reload while a session is running. Wait for it to finish or abort it first.",
        )
        return
      }
      console.error("[CodeM] handleReload: reload endpoint failed:", err)
      const detail = err instanceof Error && err.message ? err.message : "See extension logs for details."
      vscode.window.showErrorMessage(`Reload failed. ${detail}`)
      return
    }
    await this.refreshLiveCatalogs()
    if (!sameDirectory(dir, this.getWorkspaceDirectory())) {
      await this.reloadAfterAuthChange()
    }
  }

  /** Public reload entry point for VS Code commands. */
  async reload(): Promise<void> {
    return this.handleReload()
  }

  private mapSyncEventToWebviewMessage(event: LegacySyncEvent) {
    switch (event.type) {
      case "message.updated": {
        const info = event.properties.info
        return {
          type: "messageCreated" as const,
          message: {
            ...info,
            createdAt: new Date(info.time.created).toISOString(),
          },
        }
      }
      case "message.removed":
        return {
          type: "messageRemoved" as const,
          sessionID: event.properties.sessionID,
          messageID: event.properties.messageID,
        }
      case "message.part.updated":
        return {
          type: "partUpdated" as const,
          sessionID: event.properties.sessionID,
          messageID: event.properties.part.messageID,
          part: event.properties.part,
        }
      case "message.part.removed":
        return {
          type: "partRemoved" as const,
          sessionID: event.properties.sessionID,
          messageID: event.properties.messageID,
          partID: event.properties.partID,
        }
      case "session.created":
        return {
          type: "sessionCreated" as const,
          session: this.sessionToWebview(event.properties.info),
        }
      case "session.updated":
        return {
          type: "sessionUpdated" as const,
          session: this.sessionToWebview(event.properties.info),
        }
      case "session.deleted":
        return {
          type: "sessionDeleted" as const,
          sessionID: event.properties.sessionID,
        }
    }
  }

  private resolveEventSessionId(event: ProviderEvent): string | undefined {
    switch (event.type) {
      case "session.created":
      case "session.updated":
      case "session.deleted":
        return event.properties.sessionID
      case "message.updated":
        this.connectionService.recordMessageSessionId(event.properties.info.id, event.properties.sessionID)
        return event.properties.sessionID
      case "message.removed":
      case "message.part.updated":
      case "message.part.removed":
        return event.properties.sessionID
      default:
        return this.connectionService.resolveEventSessionId(event)
    }
  }

  private postModelUsageChanged(event: ProviderEvent, sessionID: string | undefined): boolean {
    if (!sessionID || this.trackedSessionIds.has(sessionID)) return false
    if (event.type === "session.created") {
      const parent = event.properties.info.parentID
      if (!parent || !this.modelUsageSessionIds.has(parent)) return false
      this.modelUsageSessionIds.add(sessionID)
      this.postMessage({ type: "sessionModelUsageChanged", sessionID })
      return true
    }
    if (!this.modelUsageSessionIds.has(sessionID)) return false
    if (event.type === "message.part.updated") {
      const part = event.properties.part as {
        type?: string
        tool?: string
        metadata?: { sessionId?: string }
        state?: { metadata?: { sessionId?: string } }
      }
      const child = childID(part)
      if (child && !this.modelUsageSessionIds.has(child)) {
        this.modelUsageSessionIds.add(child)
        this.postMessage({ type: "sessionModelUsageChanged", sessionID: child })
        return true
      }
    }
    const changed =
      event.type === "message.removed" ||
      event.type === "message.part.removed" ||
      event.type === "session.deleted" ||
      (event.type === "message.part.updated" && event.properties.part.type === "step-finish")
    if (!changed) return false
    if (event.type === "session.deleted") this.modelUsageSessionIds.delete(sessionID)
    this.postMessage({ type: "sessionModelUsageChanged", sessionID })
    return true
  }

  /**
   * Handle SSE events from the CLI backend.
   * Filters events by project ID and tracked session IDs so each webview only sees its own sessions.
   */
  private handleEvent(event: ProviderEvent, directory?: string): void {

    if (event.type === "kilo-sessions.remote-status-changed") {
      this.remoteService?.updateFromEvent({ enabled: event.properties.enabled, connected: event.properties.connected })
      return
    }


    // Drop session events from other projects before any tracking logic.
    // This must come first: the trackedSessionIds guard below would otherwise
    // let a foreign session through if it was accidentally tracked.
    if (
      directory &&
      directory !== "global" &&
      !this.isCurrentProjectDirectory(directory) &&
      !this.terminal(event, directory)
    )
      return
    if (
      this.projectID &&
      (!this.opts.projectQualifier || !directory) &&
      (event.type === "session.created" || event.type === "session.updated") &&
      event.properties.info.projectID !== undefined &&
      event.properties.info.projectID !== null &&
      event.properties.info.projectID !== this.projectID
    ) {
      return
    }

    if (event.type === "mcp.browser.open.failed") return

    if (event.type === "message.updated") {
      this.confirmations.confirm(event.properties.info.id)
    }

    // session.status events pass the onEventFiltered pre-filter for all providers (see line 842),
    // so this runs on every CodeMProvider instance — including the Settings panel which has no
    // tracked sessions. Update sessionStatusMap and forward to webview before the
    // trackedSessionIds guard so the Settings panel's allStatusMap stays current for the
    // busy-session warning on Save.
    if (event.type === "session.status") {
      const sid = event.properties.sessionID
      if (this.removedSessionIds.has(sid)) return
      const status = event.properties.status
      this.mark(sid, directory)
      this.aborts.observe(sid, status.type, directory)
      this.publish(sid, status)
      return
    }

    // Extract sessionID from the event
    if (event.type === "session.created" && this.adoptPendingFollowup(event.properties.info)) {
      return
    }

    const sessionID = this.resolveEventSessionId(event)

    // Events without sessionID (server.connected, server.heartbeat, indexing.status) → always forward
    // Events with sessionID → only forward if this webview tracks that session
    // message.part.* events are always session-scoped; drop if session unknown.
    if (!sessionID && isSessionScopedPartEvent(event.type)) return
    if (this.postModelUsageChanged(event, sessionID)) return
    if (event.type !== "session.deleted" && sessionID && !this.trackedSessionIds.has(sessionID)) return

    if (event.type === "message.part.updated") this.refreshGitStatusFromPart(event, sessionID)

    if (event.type === "session.updated" && typeof event.properties.info.cost === "number") {
      const cost = this.costs.setSessionCost(event.properties.sessionID, event.properties.info.cost)
      this.requestCostAlert(event.properties.sessionID, cost)
    }

    if (event.type === "session.updated") {
      // Full bus snapshots duplicate sync patches with the same event ID but no sequence metadata.
      if (!isLegacySyncEvent(event)) return
      const sid = event.properties.sessionID
      const revision = this.revisions.get(sid)
      const versioned = event.seq > 0 || (revision?.seq ?? 0) > 0
      if (revision && (versioned ? event.seq <= revision.seq : event.id <= revision.id)) return
      this.revisions.set(sid, { id: event.id, seq: event.seq })
    }

    // Refresh provider and agent lists when the server signals a state disposal
    if (event.type === "global.disposed") {
      void this.reloadAfterAuthChange()
      return
    }

    if (event.type === "server.instance.disposed") {
      const props = event.properties as Record<string, unknown> | null
      const dir = typeof props?.directory === "string" ? props.directory : undefined
      if (dir) for (const sid of this.aborts.dispose(dir)) this.sessionStatusMap.set(sid, "idle")
      if (dir && !sameDirectory(dir, this.getWorkspaceDirectory())) return
      void this.reloadAfterAuthChange()
      return
    }

    // Config was updated without a full dispose (e.g. permission-only save).
    // Fetch and push the updated config + refresh agents and providers so the
    // Settings panel and mode/model pickers reflect the change.
    if (event.type === "global.config.updated") {
      void this.fetchAndSendProviders()
      return
    }

    // Forward relevant events to webview
    // Side effects that must happen before the webview message is sent
    if (event.type === "message.updated") {
      const info = event.properties.info
      const value = info.role === "assistant" ? info.cost : undefined
      const cost = this.updateMessageCost(event.properties.sessionID, info.id, info.role, value)
      if (cost !== undefined) this.requestCostAlert(event.properties.sessionID, cost)
    }
    if (event.type === "message.removed") {
      this.removeMessageCost(event.properties.messageID)
    }
    if (event.type === "session.created" && !this.currentSession) {
      this.setCurrentSession(event.properties.info)
      this.contextSessionID = event.properties.info.id
      this.trackedSessionIds.add(event.properties.info.id)
    }
    if (event.type === "session.updated" && this.currentSession?.id === event.properties.sessionID) {
      this.setCurrentSession(event.properties.info)
      this.contextSessionID = event.properties.sessionID
    }
    if (event.type === "session.deleted") {
      const sid = event.properties.sessionID
      this.trackedSessionIds.delete(sid)
      this.modelUsageSessionIds.delete(sid)
      this.sessionDirectories.delete(sid)
      this.connectionService.pruneSession(sid)
      this.costs.onSessionDeleted(sid)
    }

    // Auto-adopt child sessions as soon as the task tool part reveals their ID.
    // This means the child's permission/question events are tracked immediately —
    // before the webview renderer has a chance to call syncSession — eliminating
    // the race where the child blocks on a prompt that the UI never sees.
    if (event.type === "message.part.updated") {
      const part = event.properties.part as {
        type?: string
        tool?: string
        metadata?: { sessionId?: string }
        state?: { metadata?: { sessionId?: string } }
        sessionID?: string
      }
      const childId = childID(part)
      if (childId && !this.trackedSessionIds.has(childId)) {
        console.log("[CodeM] CodeMProvider: 🔗 Auto-adopting child session from task tool", { childId })
        void this.handleSyncSession(childId, part.sessionID ?? sessionID)
      }
    }

    // Drop the per-session caches for deleted sessions so a late
    // handleLoadMessages response (or any other guarded read) can't resurrect
    // transcript state for a session the webview just cleaned up. The
    // prefilter lets session.deleted through without re-tracking, and the
    // handleEvent guard does the same — this is the matching prune.
    if (event.type === "session.deleted" && sessionID) {
      this.pruneDeletedSession(sessionID)
    }

    if (!isLegacySyncEvent(event)) {
      const props = event.properties
      handleNetworkEvent(
        event.type,
        {
          id: "id" in props && typeof props.id === "string" ? props.id : undefined,
          sessionID: "sessionID" in props && typeof props.sessionID === "string" ? props.sessionID : undefined,
          requestID: "requestID" in props && typeof props.requestID === "string" ? props.requestID : undefined,
        },
        this.client,
        (s) => this.getWorkspaceDirectory(s),
      )
    }

    const msg = isLegacySyncEvent(event)
      ? this.mapSyncEventToWebviewMessage(event)
      : mapSSEEventToWebviewMessage(event, sessionID)
    if (!msg) return
    if (msg.type === "partUpdated") {
      this.streams.push({ ...msg, part: this.slimPart(msg.part) })
      return
    }
    const next = msg.type === "messageCreated" ? { ...msg, message: this.slimInfo(msg.message) } : msg
    if (next.type === "sandboxStatus") {
      if (!sameDirectory(next.directory, this.getWorkspaceDirectory(next.sessionID))) return
      this.postMessage({ ...next, revision: ++this.sandboxRevision })
      return
    }
    this.streams.flush(sessionID)
    this.postMessage(next)
    const sid = event.type === "session.turn.close" ? event.properties.sessionID : sessionID
    if (!sid) return
    const status = this.sessionStatusMap.get(sid)
    if (!status || status === "idle") return
    if (
      event.type === "session.turn.close" ||
      (event.type === "message.updated" &&
        event.properties.info.role === "assistant" &&
        event.properties.info.finish === "stop" &&
        event.properties.info.time.completed !== undefined)
    ) {
      this.sync(sid, directory ?? this.getWorkspaceDirectory(sid))
    }
  }

  /** Wait until the webview has sent "webviewReady". Resolves immediately when already ready. */
  public waitForReady(): Promise<void> {
    if (this.isWebviewReady && this.webview) return Promise.resolve()
    const deferred = Promise.withResolvers<void>()
    this.readyResolvers.push(deferred.resolve)
    return deferred.promise
  }
  /** Post a message to the webview. Public so toolbar button commands can send messages. */
  public postMessage(message: unknown): void {
    if (!this.webview) {
      const type =
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        typeof (message as { type?: unknown }).type === "string"
          ? (message as { type: string }).type
          : "<unknown>"
      console.warn("[CodeM] CodeMProvider: ⚠️ postMessage dropped (no webview)", { type })
      return
    }

    void this.webview.postMessage(message).then(undefined, (error) => {
      console.error("[CodeM] CodeMProvider: ❌ postMessage failed", error)
    })
  }

  private flushPendingKiloModel(): void {
    if (!this.webview || !this.isWebviewReady || !this.client || !this.pendingKiloModel) return

    const pending = this.pendingKiloModel
    this.pendingKiloModel = null
    this.postMessage({ type: "selectKiloModel", ...pending })
  }

  public async appendReviewComments(comments: unknown[], autoSend = false, sessionID?: string): Promise<void> {
    this.pendingReviewComments.push({ comments, autoSend, ...(sessionID ? { sessionID } : {}) })

    if (!this.webview) {
      await vscode.commands.executeCommand(`${CodeMProvider.viewType}.focus`)
    }

    this.flushPendingReviewComments()
  }


  private flushPendingReviewComments(): void {
    if (!this.webview || !this.isWebviewReady || this.pendingReviewComments.length === 0) return

    const pending = this.pendingReviewComments
    this.pendingReviewComments = []

    for (const entry of pending) {
      this.postMessage({ type: "appendReviewComments", ...entry })
    }
  }

  /**
   * Get the git remote URL for the current workspace using VS Code's built-in Git API.
   * Returns undefined if not in a git repo or no remotes are configured.
   */
  private async getGitRemoteUrl(): Promise<string | undefined> {
    try {
      const extension = vscode.extensions.getExtension("vscode.git")
      if (!extension) return undefined
      const api = extension.isActive ? extension.exports?.getAPI(1) : (await extension.activate())?.getAPI(1)
      if (!api) return undefined
      const repo = api.repositories?.[0]
      if (!repo) return undefined
      const remote = repo.state?.remotes?.find((r: { name: string }) => r.name === "origin")
      return remote?.fetchUrl ?? remote?.pushUrl
    } catch (error) {
      console.warn("[CodeM] CodeMProvider: Failed to get git remote URL:", error)
      return undefined
    }
  }

  /**
   * Gather VS Code editor context to send alongside messages to the CLI backend.
   */
  /**
   * Return the set of relative paths for all open text-editor tabs within the
   * given directory, filtered through .kilocodeignore.
   */
  private async getOpenTabPaths(dir: string): Promise<Set<string>> {
    const controller = await this.getIgnoreController(dir)
    const result = new Set<string>()
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const uri =
          tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputNotebook
            ? tab.input.uri
            : undefined
        if (uri?.scheme !== "file") continue

        const rel = path.relative(dir, uri.fsPath)
        if (!rel.startsWith("..") && !path.isAbsolute(rel) && controller.validateAccess(uri.fsPath)) {
          result.add(rel.replaceAll("\\", "/"))
        }
      }
    }
    return result
  }

  /**
   * Get or create a FileIgnoreController for the current workspace directory.
   * Reinitializes if the workspace directory has changed.
   */
  private async getIgnoreController(workspaceDir: string): Promise<FileIgnoreController> {
    if (this.ignoreController && this.ignoreControllerDir === workspaceDir) {
      return this.ignoreController
    }
    const controller = new FileIgnoreController(workspaceDir)
    await controller.initialize()
    this.ignoreController = controller
    this.ignoreControllerDir = workspaceDir
    return controller
  }

  private async gatherEditorContext(dir?: string): Promise<EditorContext> {
    const workspaceDir = dir ?? this.getWorkspaceDirectory()
    const controller = await this.getIgnoreController(workspaceDir)

    const toRelative = (fsPath: string): string | undefined => {
      if (!workspaceDir) {
        return undefined
      }
      const relative = path.relative(workspaceDir, fsPath)
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return undefined
      }
      return relative
    }

    // Visible files (capped to avoid bloating context, filtered through .kilocodeignore)
    const visibleFiles = [
      ...new Set(
        [
          ...vscode.window.visibleTextEditors.map((editor) => notebookUri(editor.document.uri)),
          ...vscode.window.visibleNotebookEditors.map((editor) => editor.notebook.uri),
        ]
          .filter((uri): uri is vscode.Uri => uri?.scheme === "file")
          .map((uri) => toRelative(uri.fsPath))
          .filter(
            (file): file is string => file !== undefined && controller.validateAccess(path.resolve(workspaceDir, file)),
          ),
      ),
    ].slice(0, 200)

    // Open tabs — text and notebook files only; exclude diffs and custom editors
    const openTabs = [...(await this.getOpenTabPaths(workspaceDir))].slice(0, 20)

    // Active file (also filtered through .kilocodeignore)
    const activeEditor = vscode.window.activeTextEditor
    const activeUri = activeEditor
      ? notebookUri(activeEditor.document.uri)
      : vscode.window.activeNotebookEditor?.notebook.uri
    const activeRel = activeUri ? toRelative(activeUri.fsPath) : undefined
    const activeFile = activeRel && activeUri && controller.validateAccess(activeUri.fsPath) ? activeRel : undefined

    // Shell
    const shell = vscode.env.shell || undefined

    return {
      ...(visibleFiles.length > 0 ? { visibleFiles } : {}),
      ...(openTabs.length > 0 ? { openTabs } : {}),
      ...(activeFile ? { activeFile } : {}),
      ...(shell ? { shell } : {}),
    }
  }

  private getWorkspaceDirectory(sessionId?: string): string {
    const routed = this.routeSessionDirectory(sessionId ?? undefined)
    // Ambiguous ids degrade to the legacy resolution instead of throwing: this
    // runs eagerly per webview message, where a throw would drop the message.
    if (routed === null)
      console.warn(`[CodeM] CodeMProvider: session ${sessionId} is ambiguous across projects, using workspace root`)
    if (routed) return routed
    return resolveWorkspaceDirectory({
      sessionID: sessionId,
      sessionDirectories: this.sessionDirectories,
      workspaceDirectory: this.getRootDirectory(),
    })
  }

  private getSessionDirectory(sessionId: string, session?: Session): string {
    const routed = this.routeSessionDirectory(sessionId)
    if (routed === null)
      console.warn(
        `[CodeM] CodeMProvider: session ${sessionId} is ambiguous across projects, using tracked directory`,
      )
    if (routed) return routed
    return this.sessionDirectories.get(sessionId) ?? session?.directory ?? this.getRootDirectory()
  }

  /**
   * Resolve a session directory through the Agent Manager route service.
   *
   * Returns the exact directory when the route service knows the id and it is
   * unambiguous (or a project qualifier disambiguates it). Returns `undefined`
   * when no route service is configured or the id is unknown — callers then
   * fall through to the legacy sessionDirectories/workspace-root path, which
   * preserves non-Agent-Manager behavior. Returns `null` when the id is
   * ambiguous and cannot be qualified: callers must NOT fall back to an
   * arbitrary root in that case, because doing so would silently target the
   * wrong project.
   */
  private routeSessionDirectory(sessionId: string | undefined): string | null | undefined {
    const routes = this.opts.routeService
    if (!routes || !sessionId) return undefined
    const exact = routes.trySessionDirectory(sessionId)
    if (exact) return exact
    if (routes.isSessionAmbiguous(sessionId)) {
      const qualifier = this.opts.projectQualifier?.()
      if (qualifier) {
        const ref: SessionRef = { projectId: qualifier.projectId, sessionId }
        const dir = routes.trySessionDirectoryFor(ref)
        if (dir) return dir
      }
      return null
    }
    return undefined
  }

  private isCurrentProjectDirectory(directory: string): boolean {
    if (!this.opts.projectQualifier?.()) return true
    const dirs = [this.getRootDirectory(), ...(this.opts.worktreeDirectories?.() ?? [])]
    return dirs.some((dir) => sameDirectory(dir, directory))
  }

  private owned(sessionID: string, directory?: string): boolean {
    if (!directory || directory === "global" || this.syncedChildSessions.has(sessionID)) return false
    const owner = this.owners.get(sessionID)
    return owner !== undefined && sameDirectory(owner.dir, directory)
  }

  private terminal(event: ProviderEvent, directory?: string): boolean {
    if (event.type === "session.status") {
      const type = event.properties.status.type
      if (type === "idle" || type === "offline") return this.owned(event.properties.sessionID, directory)
    }
    if (event.type === "session.deleted") return this.owned(event.properties.sessionID, directory)
    return false
  }

  private isCurrentProjectSession(sessionID: string): boolean {
    if (!this.opts.projectQualifier || !this.opts.routeService) return true
    if (this.isSessionRouteAmbiguous(sessionID)) return false
    const directory = this.opts.routeService.trySessionDirectory(sessionID)
    return !directory || this.isCurrentProjectDirectory(directory)
  }

  private refreshGitStatusFromPart(
    event: Extract<ProviderEvent, { type: "message.part.updated" }>,
    sessionID?: string,
  ) {
    void this.refreshGitStatusFromParts([event.properties.part], sessionID)
  }

  private async refreshGitStatusFromParts(parts: unknown[], sessionID?: string, recover = false): Promise<boolean> {
    const base = this.getWorkspaceDirectory(sessionID)
    const edits = editPaths(parts, base)
    if (!recover && edits.length === 0) return false

    const cached = sessionID ? this.sessionGitDirectories.get(sessionID) : undefined
    if (cached) {
      await this.refreshGitStatus(cached, sessionID)
      return true
    }

    const root = await this.resolveGitRoot(base)
    if (root) {
      await this.refreshGitStatus(root, sessionID)
      return true
    }

    const file = edits.find((item) => this.isCurrentProjectGitDirectory(item, sessionID))
    if (!file) return false
    await this.refreshGitStatus(path.dirname(file), sessionID)
    return sessionID ? this.sessionGitDirectories.has(sessionID) : true
  }

  private async recoverSessionGitStatus(parts: unknown[], sessionID: string, cursor?: string): Promise<void> {
    if (await this.refreshGitStatusFromParts(parts, sessionID, true)) return
    if (!cursor || !this.client || !this.trackedSessionIds.has(sessionID)) return
    if (this.sessionGitRecoveries.has(sessionID)) return
    this.sessionGitRecoveries.add(sessionID)

    const directory = this.getWorkspaceDirectory(sessionID)
    const history = await retry(() =>
      this.client!.session.messages({ sessionID, directory, limit: 0 }, { throwOnError: true }),
    ).catch((error: unknown) => {
      console.warn("[CodeM] CodeMProvider: Failed to recover session Git directory:", error)
      return undefined
    })
    if (!history) {
      this.sessionGitRecoveries.delete(sessionID)
      return
    }
    if (!this.trackedSessionIds.has(sessionID)) return
    await this.refreshGitStatusFromParts(
      history.data.flatMap((message) => message.parts),
      sessionID,
    )
  }

  private isCurrentProjectGitDirectory(directory: string, sessionID?: string): boolean {
    const roots = this.opts.projectQualifier?.()
      ? [this.getRootDirectory(), ...(this.opts.worktreeDirectories?.() ?? [])]
      : [this.getWorkspaceDirectory(sessionID)]
    return roots.some((root) => {
      const rel = path.relative(canonicalizePath(root), canonicalizePath(directory))
      return rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`))
    })
  }

  public async refreshGitStatus(directory = this.getWorkspaceDirectory(), sessionID?: string): Promise<void> {
    const client = this.client
    if (!client) return
    const active = !sessionID || sessionID === this.contextSessionID
    const revision = active ? ++this.gitStatusRevision : undefined
    const repo = await hasGit(client, directory)
    const root = await this.resolveGitRoot(directory)
    const found = repo || root !== undefined
    const target = root ?? directory
    if (found && sessionID && !this.sessionGitDirectories.has(sessionID)) {
      this.sessionGitDirectories.set(sessionID, target)
    }
    if (sessionID && sessionID !== this.contextSessionID) return
    if (revision === undefined || revision !== this.gitStatusRevision) return
    const changed = !this.cachedGitDirectory || !sameDirectory(this.cachedGitDirectory, target)
    if (changed) {
      this.cachedStats = null
      this.statsPoller?.stop()
      this.statsPoller = null
      this.statsGitOps?.dispose()
      this.statsGitOps = null
    }
    this.cachedGitDirectory = target
    this.cachedGitRepo = found
    this.postMessage({ type: "gitStatus", repo: found })
    if (found) {
      if (!this.statsPoller) this.startStatsPolling()
      return
    }
    this.statsPoller?.stop()
    this.statsGitOps?.dispose()
    this.statsPoller = null
    this.statsGitOps = null
  }

  private async resolveGitRoot(directory: string): Promise<string | undefined> {
    const git = this.statsGitOps ?? new GitOps({ log: () => {} })
    const root = await git.root(directory)
    if (!this.statsGitOps) git.dispose()
    return root
  }

  private getContextDirectory(): string {
    return resolveContextDirectory({
      currentSessionID: this.currentSession?.id,
      contextSessionID: this.contextSessionID,
      sessionDirectories: this.sessionDirectories,
      workspaceDirectory: this.getRootDirectory(),
    })
  }

  private getRootDirectory(): string {
    const override = this.opts.rootDirectory?.()
    if (override) return override
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders && workspaceFolders.length > 0) {
      return workspaceFolders[0]!.uri.fsPath
    }
    return process.cwd()
  }

  private trackDirectory(sessionId: string, dir: string) {
    // Agent Manager Local sessions must retain their explicit project root.
    // Removing same-root entries would silently retarget them after switching
    // the panel's active project.
    this.sessionDirectories.set(sessionId, dir)
  }

  private noteFollowup(answers: string[][], sessionID?: string) {
    const dir = this.getWorkspaceDirectory(sessionID)
    this.pendingFollowup = recordFollowup({ answers, dir, now: Date.now() }) ?? null
  }

  private matchesPendingFollowup(session: Session) {
    return matchFollowup({
      pending: this.pendingFollowup,
      dir: session.directory,
      now: Date.now(),
      parentID: session.parentID,
    })
  }

  private adoptPendingFollowup(session: Session) {
    const now = Date.now()
    const match = this.matchesPendingFollowup(session)
    if (!match) {
      if (
        this.pendingFollowup &&
        !matchFollowup({ pending: this.pendingFollowup, dir: this.pendingFollowup.dir, now })
      ) {
        this.pendingFollowup = null
      }
      return false
    }

    this.pendingFollowup = null
    this.trackDirectory(session.id, session.directory)
    for (const cb of this.followupListeners) cb(session, session.directory)
    this.registerSession(session, true)
    void this.handleLoadMessages(session.id)
    return true
  }

  private getProjectDirectory(sessionId?: string): string | undefined {
    return resolveProjectDirectory(this.projectDirectory, () => this.getWorkspaceDirectory(sessionId))
  }

  private _getHtmlForWebview(webview: vscode.Webview, sidebar = false): string {
    return buildWebviewHtml(webview, {
      // The rail follows the physical workbench edge. RTL text direction must not move it between chat and code.
      sidebar: sidebar
        ? vscode.workspace.getConfiguration("workbench").get("sideBar.location") === "right"
          ? "right"
          : "left"
        : undefined,
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      workerUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "shiki-worker.js")),
      title: "CodeM",
      port: this.connectionService.getServerInfo()?.port,
      extraStyles: `.container { height: 100vh; }`,
      // Dedicated single-purpose panels (Settings, Profile, Sub-Agent Viewer)
      // never show the bar. Sidebar and "Open in Tab" only need it in Cursor —
      // VS Code's native toolbar (restored in package.json) works everywhere.
      topBar: this.opts.hideTopBar !== true && isCursorHost(),
      agentManagerSettings: this.opts.agentManagerSettings !== undefined,
    })
  }

  // ── Worktree stats polling (sidebar diff badge) ──────────────────
  private setStatsVisible(visible: boolean): void {
    this.statsVisible = visible
    this.statsPoller?.setEnabled(visible)
    this.statsPoller?.setVisible(visible)
  }

  private startStatsPolling(): void {
    if (this.opts.disableStatsPolling) return
    this.statsPoller?.stop()
    this.statsGitOps?.dispose()
    const git = new GitOps({ log: () => {} })
    this.statsGitOps = git
    this.statsPoller = new GitStatsPoller({
      getWorktrees: () => [],
      getWorkspaceRoot: () => this.cachedGitDirectory ?? this.getWorkspaceDirectory(this.currentSession?.id),
      git,
      onStats: () => {},
      onLocalStats: (stats: LocalStats) => {
        const msg = {
          type: "worktreeStatsLoaded" as const,
          files: stats.files,
          additions: stats.additions,
          deletions: stats.deletions,
        }
        this.cachedStats = msg
        this.postMessage(msg)
      },
      log: () => {},
      hiddenIntervalMs: 60000,
    })
    this.setStatsVisible(this.statsVisible)
  }

  /**
   * Dispose of the provider and clean up subscriptions.
   * Does NOT kill the server — that's the connection service's job.
   */
  dispose(): void {
    if (this.opts.focusContext) {
      void vscode.commands.executeCommand("setContext", this.opts.focusContext, false)
    }
    this.setFocusTarget("other")
    this.unsubscribeRemote?.()
    this.streams.focus(undefined)
    this.connectionService.unregisterVisible(this.instanceId)
    this.connectionService.unregisterAttached(this.instanceId)
    this.setStatsVisible(false)
    this.statsGitOps?.dispose()
    this.unsubscribeEvent?.()
    this.unsubscribeState?.()
    this.unsubscribeNotificationDismiss?.()
    this.unsubscribeLanguageChange?.()
    this.codeMAuthenticationChange?.dispose()
    this.appServerEvent?.dispose()
    this.unsubscribeFavoritesChange?.()
    this.unsubscribeClearPendingPrompts?.()
    this.unsubscribeDirectoryProvider?.()
    this.unsubscribeAcknowledged?.()
    this.viewStateDisposable?.dispose()
    this.visibilityDisposable?.dispose()
    this.webviewMessageDisposable?.dispose()
    this.autocompleteConfigDisposable?.dispose()
    this.chatConfigDisposable?.dispose()
    this.throughputConfigDisposable?.dispose()
    this.autoApprovalReasonConfigDisposable?.dispose()
    this.pushFixesConfigDisposable?.dispose()
    this.visibleTaskStreams.clear()
    this.streams.dispose()
    this.isWebviewReady = false
    this.webview = null
    // Release any waitForReady() awaiters so their callers don't hang after disposal.
    this.readyResolvers.splice(0).forEach((r) => r())
    this.promptRecoveryQueued = false
    clearNetworkWaits(this.trackedSessionIds)
    this.trackedSessionIds.clear()
    this.removedSessionIds.clear()
    this.openSessionIds.clear()
    this.syncedChildSessions.clear()
    this.inspectorSessionIds.clear()
    this.draftSessions.clear()
    this.sessionDirectories.clear()
    this.owners.clear()
    this.anacondaDesktop.dispose()
    this.aborts.clear()
    this.requests.clear()
    this.epochs.clear()
    this.sessionStatusMap.clear()
    this.ignoreController?.dispose()
    this.chatAutocomplete?.dispose()
    disposeGitChangesTarget()
  }
}
