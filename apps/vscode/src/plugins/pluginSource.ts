import type { PluginSource } from "@codem/app-server"
import { UserVisibleError } from "../shared/userVisibleError.ts"

/** A folder chosen in the Host's picker. */
export interface PickedFolder { readonly scheme: string; readonly fsPath: string }

/**
 * The install source for a plugin folder the user picks. Closing the picker is no source, not an error; a
 * picker that settles after the operation was cancelled stops there; a folder the extension host cannot read
 * as a local path is refused before Core sees it.
 */
export async function pickLocalPlugin(pick: () => Promise<readonly PickedFolder[] | undefined>, signal: AbortSignal): Promise<PluginSource | null> {
  const folder = (await pick())?.[0]
  signal.throwIfAborted()
  if (!folder) return null
  if (folder.scheme !== "file") throw new UserVisibleError("插件需要可访问的本地文件夹。")
  return { kind: "local", path: folder.fsPath }
}
