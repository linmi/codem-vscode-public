import assert from "node:assert/strict"
import { it } from "node:test"
import { hostedRepository, pullRequestUrl } from "../src/integrations/pullRequest.ts"

it("recognises GitHub and GitLab remotes in https, ssh and scp forms and nothing else", () => {
  for (const url of ["https://github.com/linmi/codem-vscode-public.git", "https://token@github.com/linmi/codem-vscode-public", "git@github.com:linmi/codem-vscode-public.git", "ssh://git@github.com:22/linmi/codem-vscode-public/"]) {
    assert.deepEqual(hostedRepository(url), { host: "github.com", path: "linmi/codem-vscode-public", kind: "github" }, url)
  }
  assert.deepEqual(hostedRepository("git@gitlab.com:group/sub/project.git"), { host: "gitlab.com", path: "group/sub/project", kind: "gitlab" })
  for (const url of ["https://git.example.com/a/b.git", "https://github.com/only-owner", "/local/path/repo", "", "https://github.com/a/b/c"]) assert.equal(hostedRepository(url), null, url)
})

it("builds the host's own new pull or merge request page, keeping branch slashes", () => {
  assert.equal(pullRequestUrl({ host: "github.com", path: "linmi/app", kind: "github" }, "main", "feat/x y"), "https://github.com/linmi/app/compare/main...feat/x%20y?expand=1")
  assert.equal(pullRequestUrl({ host: "gitlab.com", path: "g/p", kind: "gitlab" }, "main", "fix/a"), "https://gitlab.com/g/p/-/merge_requests/new?merge_request%5Bsource_branch%5D=fix%2Fa&merge_request%5Btarget_branch%5D=main")
})
