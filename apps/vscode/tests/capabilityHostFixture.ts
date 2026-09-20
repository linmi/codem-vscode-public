import type { ChatHost } from "../src/chatController.ts"

/** Explicit fixture capabilities. Unexpected calls fail instead of reporting fake success. */
export function capabilityHostFixture() {
  const absent = async (): Promise<never> => { throw new Error("Capability not configured in fixture") }
  return {
    control: absent, compactThread: absent, rewindThread: absent, clearThread: absent, steerTurn: absent,
    startSideQuestion: absent, cancelSideQuestion: absent, runShellCommand: absent, listSkills: absent,
    readEnvironmentInfo: absent, readConfigSnapshot: absent, listHooks: absent, listPlugins: absent,
    listPermissionProfiles: absent, readCoreSpaceSnapshot: absent, readModelProviderCapabilities: absent,
    listLoadedThreadIds: absent, listLiveThreadTurns: absent, listLiveThreadItems: absent,
  } satisfies Partial<ChatHost>
}
