import type { AppServerAuthStatus } from "@codem/app-server"

export interface CodeMWebviewProfile {
  readonly profile: {
    readonly email: string
    readonly name?: string
  }
  readonly balance: null
  readonly kiloPass: null
  readonly currentOrgId: string | null
}

/** Project the credential broker identity into the mature profile surface. */
export function codeMWebviewProfile(status: AppServerAuthStatus): CodeMWebviewProfile | null {
  if (!status.loggedIn) return null
  return {
    profile: {
      email: status.userId ?? "",
      ...(status.displayName ? { name: status.displayName } : {}),
    },
    balance: null,
    kiloPass: null,
    currentOrgId: status.tenantId,
  }
}
