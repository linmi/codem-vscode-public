export type { CodemUiHost, HostDraftCommand, MountHandle } from "./host.ts"
export { mountCodemUi } from "./mount.tsx"
export {
  asSnapshot,
  elapsedTime,
  hiddenUntilReady,
  initialSnapshot,
  isSignedIn,
  normalizeMessages,
  normalizePhase,
  parseUiAction,
  visibleControls,
  type AccountState,
  type ChatMessage,
  type ChatSnapshot,
} from "./contract.ts"
export { timelineGroups, workGroupState, lastActivityId } from "./chat/timelineGroups.ts"
export { activityTitle, activityBadge, toolPresentation } from "./chat/toolPresentation.ts"
export { builtinSlashCommands, slashQuery, commandUnavailable, slashCatalog } from "./chat/slashCommands.ts"
export { welcomeState } from "./chat/welcomeState.ts"

export { LiveSnapshotView } from "./chat/liveSnapshotView.tsx"
