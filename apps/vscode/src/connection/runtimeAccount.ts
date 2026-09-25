import { accountProfilePath, readAccountAvatar } from "./accountAvatar.ts"
import { homedir } from "node:os"
import * as vscode from "vscode"
import { type AppServerAuthStatus, readAppServerAuthStatus, signOutAppServer, resolveBundledAppServerRuntime, startAppServerLogin } from "@codem/app-server"
import { UserVisibleError } from "../shared/userVisibleError.ts"
import type { AccountIdentity, AccountOperations } from "./accountController.ts"

/** Auth runs in the user's home, independent of workspace trust, selection and Core. */
export function accountOperations(extensionRoot: string, timing?: (stage: "status" | "login" | "logout", durationMs: number) => void): AccountOperations {
  const options = async () => ({ runtime: await resolveBundledAppServerRuntime({ extensionRoot }), workingDirectory: homedir() })
  const identity = async (status: AppServerAuthStatus, signal: AbortSignal): Promise<AccountIdentity> => ({ ...status, avatar: await readAccountAvatar(status, accountProfilePath(process.env, homedir()), signal) })
  const read = async (authentication: Awaited<ReturnType<typeof options>>, signal: AbortSignal) => {
    const started = performance.now()
    try { return await readAppServerAuthStatus({ ...authentication, signal }) }
    finally { timing?.("status", Math.round(performance.now() - started)) }
  }
  return {
    logout: async signal => {
      const started = performance.now()
      try { return await signOutAppServer({ ...(await options()), signal }) }
      finally { timing?.("logout", Math.round(performance.now() - started)) }
    },
    read: async signal => identity(await read(await options(), signal), signal),
    login: async (signal, progress) => {
      const authentication = await options()
      const current = await read(authentication, signal)
      signal.throwIfAborted()
      if (current.loggedIn && current.routerCredential === true) return identity(current, signal)
      const started = performance.now()
      const login = startAppServerLogin({
        ...authentication,
        presentAuthorization: async url => {
          signal.throwIfAborted()
          const uri = vscode.Uri.parse(url)
          if (uri.scheme !== "https") throw new UserVisibleError("登录服务返回了不安全的地址。")
          if (!await vscode.env.openExternal(uri)) throw new UserVisibleError("无法打开登录页面，请检查默认浏览器。")
          progress("waiting")
        },
        onProgress: stage => { if (stage === "binding") progress("binding") },
      })
      const cancel = () => { void login.cancel().catch(() => undefined) }
      signal.addEventListener("abort", cancel, { once: true })
      if (signal.aborted) cancel()
      try { return await identity(await login.completed, signal) }
      finally { signal.removeEventListener("abort", cancel); timing?.("login", Math.round(performance.now() - started)) }
    },
  }
}
