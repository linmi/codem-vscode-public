import { SpaceDirectory } from "../src/spaceDirectory.ts"
export const fixtureIdentity = { loggedIn: true, authMethod: "fixture", routerCredential: true, userId: "user", tenantId: "tenant", serverUrl: "https://example.invalid", displayName: "Fixture" }
export const fixtureSpaces = { current: "testSpace", spaces: [{ projectKey: "testSpace", displayName: "测试空间" }] }
export function fixtureSpaceDirectory(): SpaceDirectory { return new SpaceDirectory(fixtureSpaces, fixtureIdentity, async () => fixtureSpaces) }
