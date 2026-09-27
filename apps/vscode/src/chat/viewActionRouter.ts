import type { ChatController, ChatSession } from "./chatController.ts"
import type { ChatSurfaces } from "./chatSurfaces.ts"
import type { AccountController } from "../connection/accountController.ts"
import type { AutoConnect } from "../connection/autoConnect.ts"
import type { EditorSelection } from "../integrations/editorSelection.ts"
import type { NativeFeatures } from "../integrations/nativeFeatures.ts"
import type { PanelBroker } from "../panels/panelBroker.ts"
import type { SelectedCodeState } from "../resources/selectedCode.ts"
import type { FileSearchResult, FileSelected, ImageResult, SendResult, ViewAction } from "../shared/messages.ts"
import type { PasteImagesResult } from "../shared/pastedImages.ts"
import { pickLocalPlugin } from "../plugins/pluginSource.ts"

export type ViewReply = PasteImagesResult | SendResult | FileSearchResult | FileSelected | ImageResult

/** The actions a signed-out account may send; every other action is refused before it reaches a feature. */
const signedOutActions: ReadonlySet<ViewAction["type"]> = new Set(["ready", "signIn", "signOut", "cancelSignIn", "refreshAccount", "showOutput"])

type RoutedChat = Pick<ChatController,
  | "connect" | "resetAccount" | "currentThreadId" | "newChat" | "send" | "assertContextWorkspace" | "stop"
  | "showPluginManagement" | "closePluginManagement" | "cancelPluginOperation" | "changePlugin" | "installPlugin"
  | "showConversationSearch" | "closeConversationSearch" | "searchConversation" | "selectConversationSearchHit"
  | "showHistory" | "closeHistory" | "refreshHistory" | "loadMoreThreads" | "resumeThread" | "loadOlderMessages" | "reloadHistory"
  | "loadCatalog" | "loadMoreLiveSnapshot" | "cancelLiveSnapshot" | "selectSkill"
  | "steer" | "askSideQuestion" | "cancelSideQuestion" | "shellCommand" | "startControl" | "manageThread"
  | "addDirectory" | "removeDirectory" | "chooseModel" | "chooseSpace" | "refreshSpaces" | "setComposerSetting" | "configure"
  | "searchFiles" | "selectFile" | "pasteImages" | "addAttachments" | "dropAttachments" | "openArtifact" | "loadImage" | "removeAttachment" | "showDiff"
  | "refreshTools" | "refreshBackground" | "cleanBackground" | "terminateBackground" | "cancelTask" | "showBackgroundLog">

/** Exactly what the router calls; no module receives the whole of another. */
export interface ViewActionTargets {
  account: Pick<AccountController, "signedIn" | "initialize" | "publish" | "login" | "logout" | "cancel" | "refresh">
  autoConnect: Pick<AutoConnect, "run" | "reset">
  chat: RoutedChat
  selection: Pick<EditorSelection, "send" | "reveal"> & { readonly state: Pick<SelectedCodeState, "pin" | "remove" | "clear"> }
  surfaces: Pick<ChatSurfaces, "resetDraft" | "saveSendKey">
  panels: Pick<PanelBroker, "cancel">
  features: Pick<NativeFeatures, "pickPluginFolder" | "pickDirectories" | "selectMcp" | "findFiles" | "pickAttachments" | "showArtifact" | "showDiff" | "showChangedFile" | "showLog">
  sessions: { reopen(session: ChatSession, key: string, signal: AbortSignal): Promise<ChatSession> }
  showOutput(): void
  showError(message: string): void
  log(line: string): void
}

/**
 * Maps each parsed Webview action to the feature call that handles it, and owns no state. It refuses what a
 * signed-out account may not do, drops thread controls aimed at a thread that is no longer current, and turns
 * results and failures into the receipts the surface waits for.
 */
export class ViewActionRouter {
  private readonly targets: ViewActionTargets
  constructor(targets: ViewActionTargets) { this.targets = targets }

  async dispatch(action: ViewAction, reply: (result: ViewReply) => void): Promise<void> {
    const { account, autoConnect, chat, selection, surfaces, features, sessions } = this.targets
    if (!account.signedIn && !signedOutActions.has(action.type)) {
      if (action.type === "pasteImages") reply({ type: "pasteImagesResult", requestId: action.requestId, error: "请先登录后再粘贴图片。" })
      if (action.type === "send") reply({ type: "sendResult", requestId: action.requestId, accepted: false })
      account.publish(); return
    }
    // Thread controls were composed against the thread the surface showed; a thread switched since must not receive them.
    const current = (threadId: string) => threadId === chat.currentThreadId()
    switch (action.type) {
      case "ready": await account.initialize(); account.publish(); await autoConnect.run(); break
      // The surface container settles drafts, context receipts and panel replies itself.
      case "composerChanged": case "composerRestore": case "chatFocus": case "contextAdded": case "panelReply": break
      case "connect": await account.initialize(); if (account.signedIn) await chat.connect(); else account.publish(); break
      case "signOut": await account.logout(() => this.endSession()); break
      case "signIn": await account.login(); break
      case "cancelSignIn": account.cancel(); break
      case "refreshAccount": await account.refresh(); break
      case "showPluginManagement": await chat.showPluginManagement(); break
      case "closePluginManagement": chat.closePluginManagement(); break
      case "cancelPluginOperation": chat.cancelPluginOperation(); break
      case "changePlugin": await chat.changePlugin(action.action, action.id); break
      case "installMarketplacePlugin": await chat.installPlugin(async () => ({ kind: "marketplace", spec: action.spec })); break
      case "installLocalPlugin": await chat.installPlugin(signal => pickLocalPlugin(() => features.pickPluginFolder(), signal)); break
      case "showConversationSearch": chat.showConversationSearch(); break
      case "closeConversationSearch": chat.closeConversationSearch(); break
      case "searchConversation": await chat.searchConversation(action.query); break
      case "selectConversationSearchHit": await chat.selectConversationSearchHit(action.id); break
      case "showHistory": await chat.showHistory(); break
      case "closeHistory": chat.closeHistory(); break
      case "refreshHistory": await chat.refreshHistory(); break
      case "moreThreads": await chat.loadMoreThreads(); break
      case "resumeThread": await chat.resumeThread(action.threadId); break
      case "olderMessages": await chat.loadOlderMessages(); break
      case "reloadHistory": await chat.reloadHistory(); break
      case "newChat": await chat.newChat(); selection.state.clear(); break
      case "pinCodeSelection": selection.state.pin(action.id); break
      case "removeCodeSelection": selection.state.remove(action.id); break
      case "revealCodeSelection": await selection.reveal(action.id); break
      case "send": {
        let accepted = false
        try { accepted = await selection.send(action.text, action.selectionIds, text => chat.send(text), path => chat.assertContextWorkspace(path)) }
        catch (error) { this.targets.showError(error instanceof Error ? error.message : "无法附带选中代码，请重新选择后重试。") }
        reply({ type: "sendResult", requestId: action.requestId, accepted }); break
      }
      case "stop": await chat.stop(); break
      case "loadCatalog": await chat.loadCatalog(action.kind); break
      case "loadMoreLiveSnapshot": await chat.loadMoreLiveSnapshot(action.snapshotId, action.kind); break
      case "cancelLiveSnapshot": chat.cancelLiveSnapshot(action.snapshotId); break
      case "selectSkill": chat.selectSkill(action.id); break
      case "steer": if (current(action.threadId)) await chat.steer(action.text, action.requestId); break
      case "askSideQuestion": if (current(action.threadId)) await chat.askSideQuestion(action.text, action.requestId); break
      case "cancelSideQuestion": await chat.cancelSideQuestion(); break
      case "shellCommand": if (current(action.threadId)) await chat.shellCommand(action.text, action.requestId); break
      case "compactThread": if (current(action.threadId)) await chat.startControl("compact", action.requestId); break
      case "rewindThread": if (current(action.threadId)) await chat.startControl("rewind", action.requestId); break
      case "clearThread": if (current(action.threadId)) await chat.manageThread("clear", action.threadId, "", action.requestId); break
      // History operations name their thread explicitly and may target any listed thread.
      case "manageThread": await chat.manageThread(action.operation, action.threadId, action.name, action.requestId); break
      case "addDirectory": await chat.addDirectory(() => features.pickDirectories()); break
      case "removeDirectory": await chat.removeDirectory(action.id); break
      case "chooseModel": await chat.chooseModel(action.id); break
      case "chooseSpace": await chat.chooseSpace(action.id, (session, key, signal) => sessions.reopen(session, key, signal)); break
      case "refreshSpaces": await chat.refreshSpaces(); break
      case "setEffort": case "setWorkMode": case "setPermission": await chat.setComposerSetting(action); break
      case "manageMcp": await chat.configure(settings => features.selectMcp(settings)); break
      case "searchFiles": {
        try { reply({ type: "fileSearchResult", requestId: action.requestId, files: await chat.searchFiles(action.query, (cwd, query) => features.findFiles(cwd, query)), error: null }) }
        catch { reply({ type: "fileSearchResult", requestId: action.requestId, files: [], error: "文件搜索失败，请重试。" }) }
        break
      }
      case "selectFile": {
        try { reply({ type: "fileSelected", requestId: action.requestId, accepted: await chat.selectFile(action.id) }) }
        catch { reply({ type: "fileSelected", requestId: action.requestId, accepted: false }) }
        break
      }
      case "pasteImages": reply({ type: "pasteImagesResult", requestId: action.requestId, error: await chat.pasteImages(action) }); break
      case "pickAttachment": await chat.addAttachments(() => features.pickAttachments(action.kind)); break
      case "dropAttachments": await chat.dropAttachments(action.uris); break
      case "openArtifact": await chat.openArtifact(action.id, source => features.showArtifact(source)); break
      case "loadImage": reply({ type: "imageResult", id: action.id, preview: await chat.loadImage(action.id) }); break
      case "removeAttachment": chat.removeAttachment(action.id); break
      case "openDiff": await chat.showDiff(action.id, (diff, cwd) => features.showDiff(diff, cwd)); break
      case "openChangedFile": await chat.showDiff(action.id, (diff, cwd) => features.showChangedFile(diff, cwd)); break
      case "refreshTools": await chat.refreshTools(); break
      case "refreshBackground": await chat.refreshBackground(); break
      case "cleanBackground": await chat.cleanBackground(); break
      case "terminateBackground": await chat.terminateBackground(action.id); break
      case "cancelBackgroundTask": await chat.cancelTask(action.id); break
      case "openBackgroundLog": await chat.showBackgroundLog(action.id, path => features.showLog(path)); break
      case "showOutput": this.targets.showOutput(); break
      // The Webview applies its theme and pinned selection locally.
      case "setTheme": case "pinSelection": break
      case "setSendKey": await surfaces.saveSendKey(action.sendKey); break
      // A new action type must be routed here before it compiles.
      default: action satisfies never
    }
  }

  /** Retires what belongs to the signed-out account, in this order, then resets the chat. */
  private async endSession(): Promise<void> {
    const { panels, selection, surfaces, autoConnect, chat, log } = this.targets
    panels.cancel(); selection.state.clear(); surfaces.resetDraft()
    autoConnect.reset()
    const started = performance.now()
    try { await chat.resetAccount() }
    finally { log(`Account disconnect: ${Math.round(performance.now() - started)}ms`) }
  }
}
