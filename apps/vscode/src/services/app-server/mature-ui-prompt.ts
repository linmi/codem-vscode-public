import * as path from "node:path"
import { lstat, realpath } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import type { AppServerPromptAttachment } from "@codem/app-server"
import type { WebviewMessage } from "../../../webview-ui/src/types/messages/webview-messages"
import type { MatureUiPrompt } from "./mature-ui-controller"

type SendMessage = Extract<WebviewMessage, { readonly type: "sendMessage" }>

export async function prepareMatureUiPrompt(message: SendMessage, workspaceDirectory: string): Promise<MatureUiPrompt> {
  if (message.review || message.browserFeedback) {
    throw new Error("CodeM App Server does not yet support review or browser-feedback submissions")
  }
  const root = await realpath(workspaceDirectory)
  const attachments: AppServerPromptAttachment[] = []
  for (const file of message.files ?? []) {
    if (!file.url.startsWith("file:")) {
      throw new Error(
        `CodeM App Server cannot send ${file.url.startsWith("data:") ? "pasted" : "session"} attachments yet`,
      )
    }
    const target = await realpath(fileURLToPath(file.url))
    if (!isWithin(root, target))
      throw new Error(`Attachment ${file.filename ?? target} is outside the active workspace`)
    const info = await lstat(target)
    attachments.push(
      info.isDirectory()
        ? { kind: "directory", path: target }
        : file.mime.startsWith("image/")
          ? { kind: "image", path: target }
          : { kind: "file", path: target },
    )
  }
  return { text: message.text, attachments }
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}
