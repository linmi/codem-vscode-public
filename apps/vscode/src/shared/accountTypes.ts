export interface AccountProfile {
  displayName: string | null
  userId: string | null
  tenantId: string | null
  authMethod: string | null
}
export type AccountState =
  | { status: "checking" }
  | { status: "signedOut"; notice: string | null }
  | { status: "signingIn"; progress: "opening" | "waiting" | "binding" | "cancelling" }
  | { status: "signedIn"; profile: AccountProfile; refreshing: boolean; notice: string | null }
  | { status: "error"; message: string }
export interface AccountMessage { type: "account"; state: AccountState }
export type AccountAction = { type: "signIn" | "cancelSignIn" | "refreshAccount" }
