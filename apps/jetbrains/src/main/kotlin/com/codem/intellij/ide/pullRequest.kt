package com.codem.intellij.ide

import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/** A hosted repository recognised from a git remote URL, ported from the VS Code `integrations/pullRequest.ts`. */
data class HostedRepository(val host: String, val path: String, val kind: Kind) {
    enum class Kind { GitHub, GitLab }
}

object PullRequests {
    private val remote = Regex("""^(?:https?://(?:[^@/]+@)?|ssh://(?:[^@/]+@)?|[^@/\s]+@)([^/:\s]+)(?::\d+)?[/:](\S+?)(?:\.git)?/?$""")
    private val repositoryPath = Regex("""^[\w.-]+(/[\w.-]+)+$""")

    /**
     * Recognises `https://host/owner/repo(.git)`, `ssh://git@host/owner/repo` and `git@host:owner/repo` on github.com
     * and gitlab.com. Other hosts return null; guessing their web routes would open wrong pages.
     */
    fun hostedRepository(remoteUrl: String): HostedRepository? {
        val match = remote.find(remoteUrl.trim()) ?: return null
        val host = match.groupValues[1].lowercase()
        val path = match.groupValues[2].trimStart('/')
        if (!repositoryPath.matches(path)) return null
        if (host == "github.com" && path.split("/").size == 2) return HostedRepository(host, path, HostedRepository.Kind.GitHub)
        if (host == "gitlab.com") return HostedRepository(host, path, HostedRepository.Kind.GitLab)
        return null
    }

    /** The host's own "new pull/merge request" page for [branch] into [base]; creating it stays on that page. */
    fun url(repository: HostedRepository, base: String, branch: String): String {
        val root = "https://${repository.host}/${repository.path}"
        return when (repository.kind) {
            HostedRepository.Kind.GitHub -> "$root/compare/${ref(base)}...${ref(branch)}?expand=1"
            HostedRepository.Kind.GitLab ->
                "$root/-/merge_requests/new?${query("merge_request[source_branch]")}=${query(branch)}&${query("merge_request[target_branch]")}=${query(base)}"
        }
    }

    private fun ref(name: String): String = name.split("/").joinToString("/") { encode(it) }

    /** encodeURIComponent, as the VS Code path segments use. */
    private fun encode(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20").replace("%21", "!").replace("%27", "'")
            .replace("%28", "(").replace("%29", ")").replace("%7E", "~")

    /** URLSearchParams form encoding: spaces become `+`. */
    private fun query(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8)
}
