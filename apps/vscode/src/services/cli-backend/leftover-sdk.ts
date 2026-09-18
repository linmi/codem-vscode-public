/**
 * Single leftover `@kilocode/sdk` entry for Host production code.
 * Other Host files must import these types from here, never from `@kilocode/sdk`.
 * `createKiloClient` is fail-closed: `getServer()` already refuses to spawn `kilo serve`.
 */
export type {
  Config,
  Event,
  EventKilocodeNotebookCancelled,
  EventKilocodeNotebookRequested,
  EventSessionTurnClose,
  FilePartInput,
  GlobalEvent,
  IndexingStatus,
  KiloClient,
  KilocodeSessionImportMessageData,
  KilocodeSessionImportPartData,
  KilocodeSessionImportProjectData,
  KilocodeSessionImportSessionData,
  McpStatus,
  NotebookFailure,
  NotebookRequest,
  NotebookResult,
  PermissionRequest,
  ProviderUsage,
  QuestionRequest,
  SuggestionRequest,
  TextPartInput,
} from "@kilocode/sdk/v2/client"
import { kiloTransportRetiredError } from "../../shared/kilo-transport-retired.ts"

export function createKiloClient(_config: { baseUrl: string; headers?: Record<string, string> }): never {
  throw kiloTransportRetiredError("createKiloClient")
}
