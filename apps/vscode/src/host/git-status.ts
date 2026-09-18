import type { KiloClient } from "../services/cli-backend/leftover-sdk"
export async function hasGit(client: KiloClient, directory: string): Promise<boolean> {
  return Promise.resolve()
    .then(() => client.project.current({ directory }))
    .then((r) => r.data?.vcs === "git")
    .catch(() => false)
}
