import type { KiloClient } from "../services/cli-backend/leftover-sdk"
export async function stopSessionProcesses(
  client: KiloClient | null,
  sessionID: string,
  directory: string,
): Promise<void> {
  if (!client) return
  await client.backgroundProcess
    .stopSession({ sessionID, directory })
    .catch((err: unknown) => console.warn("[CodeM] CodeMProvider: Failed to stop background processes:", err))
}
