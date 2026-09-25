import * as vscode from "vscode"
import type { AccountController } from "../connection/accountController.ts"
import type { SelectedCodeState } from "../resources/selectedCode.ts"
import type { ChatController } from "./chatController.ts"
import type { ChatSurfaces } from "./chatSurfaces.ts"

export interface ChatCommandTargets {
  surfaces: Pick<ChatSurfaces, "focus" | "openInTab" | "openInSidebar" | "openAccount">
  chat: Pick<ChatController, "stop" | "toggleHistory" | "newChat" | "connect">
  account: Pick<AccountController, "signedIn" | "initialize" | "snapshot" | "login">
  selection: Pick<SelectedCodeState, "clear">
  showOutput(): void
}

/**
 * The chat's contributed commands. They reuse the account state already known and read it only while it is
 * still being checked; the account page owns refreshing it. Opening the account never focuses the composer.
 */
export function registerChatCommands({ surfaces, chat, account, selection, showOutput }: ChatCommandTargets): vscode.Disposable {
  const commands: Record<string, () => unknown> = {
    "codem.open": () => surfaces.focus(),
    "codem.focusChatInput": () => surfaces.focus(),
    "codem.openInTab": () => surfaces.openInTab(),
    "codem.openInSidebar": () => surfaces.openInSidebar(),
    "codem.settings": () => vscode.commands.executeCommand("workbench.action.openSettings", "@ext:codem.codem"),
    "codem.stop": () => chat.stop(),
    "codem.history": async () => { await surfaces.focus(); await chat.toggleHistory() },
    "codem.newChat": async () => { await surfaces.focus(); await chat.newChat(); selection.clear() },
    "codem.connect": async () => { await account.initialize(); if (account.signedIn) await chat.connect(); else await surfaces.focus() },
    "codem.account": async () => { if (account.snapshot().status === "checking") await account.initialize(); await surfaces.openAccount() },
    "codem.signIn": async () => {
      if (account.snapshot().status === "checking") await account.initialize()
      if (account.signedIn) await surfaces.openAccount()
      else {
        await surfaces.focus()
        if (account.snapshot().status === "signedOut" || account.snapshot().status === "error") await account.login()
      }
    },
    "codem.showOutput": () => showOutput(),
  }
  return vscode.Disposable.from(...Object.entries(commands).map(([name, run]) => vscode.commands.registerCommand(name, run)))
}
