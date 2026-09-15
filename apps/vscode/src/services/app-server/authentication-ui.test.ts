import { describe, expect, it } from "bun:test"
import { codeMWebviewProfile } from "./authentication-ui.ts"

describe("codeMWebviewProfile", () => {
  it("projects the CodeM broker identity without inventing legacy account data", () => {
    expect(
      codeMWebviewProfile({
        loggedIn: true,
        authMethod: "oauth",
        routerCredential: true,
        serverUrl: "https://codem.example.com",
        tenantId: "tenant-1",
        userId: "user-1",
        displayName: "CodeM User",
      }),
    ).toEqual({
      profile: { email: "user-1", name: "CodeM User" },
      balance: null,
      kiloPass: null,
      currentOrgId: "tenant-1",
    })
  })

  it("projects signed-out status as no profile", () => {
    expect(
      codeMWebviewProfile({
        loggedIn: false,
        authMethod: null,
        routerCredential: null,
        serverUrl: null,
        tenantId: null,
        userId: null,
        displayName: null,
      }),
    ).toBeNull()
  })
})
