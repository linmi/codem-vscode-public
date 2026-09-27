/** A hosted repository recognised from a git remote URL. */
export interface HostedRepository { host: string; path: string; kind: "github" | "gitlab" }

/**
 * Recognises `https://host/owner/repo(.git)`, `ssh://git@host/owner/repo` and `git@host:owner/repo` on github.com
 * and gitlab.com. Other hosts return null; guessing their web routes would open wrong pages.
 */
export function hostedRepository(remoteUrl: string): HostedRepository | null {
  const url = remoteUrl.trim()
  const match = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/\s]+@)([^/:\s]+)(?::\d+)?[/:]([^\s]+?)(?:\.git)?\/?$/.exec(url)
  if (!match) return null
  const host = match[1]!.toLowerCase()
  const path = match[2]!.replace(/^\/+/, "")
  if (!/^[\w.-]+(\/[\w.-]+)+$/.test(path)) return null
  if (host === "github.com" && path.split("/").length === 2) return { host, path, kind: "github" }
  if (host === "gitlab.com") return { host, path, kind: "gitlab" }
  return null
}

/** The host's own "new pull/merge request" page for `branch` into `base`; creating it stays on that page. */
export function pullRequestUrl(repository: HostedRepository, base: string, branch: string): string {
  const root = `https://${repository.host}/${repository.path}`
  const ref = (name: string) => name.split("/").map(encodeURIComponent).join("/")
  if (repository.kind === "github") return `${root}/compare/${ref(base)}...${ref(branch)}?expand=1`
  const query = new URLSearchParams({ "merge_request[source_branch]": branch, "merge_request[target_branch]": base })
  return `${root}/-/merge_requests/new?${query}`
}
