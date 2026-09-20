export type AccountAvatar = { kind: "none" } | { kind: "unavailable" } | { kind: "image"; url: string }
export interface AccountProfile {
  avatar: AccountAvatar
  displayName: string | null
  userId: string | null
  tenantId: string | null
  authMethod: string | null
}
export type AccountState =
  | { status: "checking" }
  | { status: "signingOut" }
  | { status: "signOutFailed"; message: string }
  | { status: "signedOut"; notice: string | null }
  | { status: "signingIn"; progress: "opening" | "waiting" | "binding" | "cancelling" }
  | { status: "signedIn"; profile: AccountProfile; refreshing: boolean; notice: string | null }
  | { status: "error"; message: string }
export interface AccountMessage { type: "account"; state: AccountState }
export type AccountAction = { type: "signIn" | "cancelSignIn" | "refreshAccount" | "signOut" }
