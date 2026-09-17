# Kilo Code upstream baseline

## Snapshot

| Field               | Value                                                              |
| ------------------- | ------------------------------------------------------------------ |
| Upstream repository | <https://github.com/Kilo-Org/kilocode>                             |
| Commit              | `c36e22634860e06e0aa63234fae37bbd83d3b182`                         |
| Commit date         | 2026-09-11                                                         |
| VS Code package     | `kilo-code` 7.6.2                                                  |
| Minimum VS Code API | `^1.105.1`                                                         |
| License             | MIT; retain repository, package, OpenCode, and third-party notices |

The source was imported as an exact tracked-tree snapshot using `git archive`, with the documented exclusions below. On 2026-09-15 that snapshot was reorganized and pruned as recorded below, so the current tree is intentionally no longer a path-for-path Kilo checkout.

## Intentional exclusions and replacements

| Upstream path                    | Local treatment                                                        | Reason                                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `.github/`                       | Not imported                                                           | Prevent upstream CI, release, publication, issue automation, and secret expectations from becoming active in the CodeM repository. |
| `/AGENTS.md`                     | Replaced by the local root `AGENTS.md`                                 | Establish CodeM product invariants and migration rules.                                                                            |
| `packages/kilo-vscode/AGENTS.md` | Moved to `apps/vscode/AGENTS.md` with a local CodeM migration preamble | Preserve package architecture and test knowledge while making its Kilo runtime sections descriptive rather than normative.         |

Local files that are not part of the upstream snapshot:

- `vscode-plugin-plan.md`
- root `AGENTS.md`
- this provenance file

## Reproduction

The import can be reproduced from a clean directory with:

```bash
git clone --filter=blob:none https://github.com/Kilo-Org/kilocode.git /tmp/kilocode
git -C /tmp/kilocode archive c36e22634860e06e0aa63234fae37bbd83d3b182 | tar -x -C /tmp/kilocode-stage
rsync -a --exclude='/.github/' --exclude='/AGENTS.md' /tmp/kilocode-stage/ ./
```

The command documents provenance; do not run it over a modified worktree. A future refresh must use a staging directory, compare the exact diff, and import only approved files.

## Baseline verification status

Partial baseline verification was performed on 2026-09-14 on macOS arm64. The host default was Bun 1.4.0, so final reproducibility checks used the repository-pinned Bun 1.3.14 via `bunx bun@1.3.14`.

| Check                               | Result                                                                                                                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Imported tracked content            | Passed. Checksum comparison against the archived snapshot found no content differences outside the documented local files and `apps/vscode/AGENTS.md` preamble.                                                            |
| `install --frozen-lockfile`         | Passed with Bun 1.3.14. The imported `bun.lock` checksum remained unchanged.                                                                                                                                               |
| VS Code typecheck                   | Passed with Bun 1.3.14.                                                                                                                                                                                                    |
| VS Code lint                        | Passed with Bun 1.3.14.                                                                                                                                                                                                    |
| Production package build            | Passed with Bun 1.3.14, including the generated SDK consistency step, CLI binary build, CLI version/models smoke checks, and extension production bundle.                                                                  |
| Representative unit tests           | Passed: 83 tests across `font-size-arch.test.ts`, `session-title.test.ts`, and `prompt-send-contract.test.ts`.                                                                                                             |
| `worktree-manager.test.ts`          | Not green on this host: 115 passed, 1 skipped, 2 failed. Both failures expected a Git checkout hook to write a `workers` file, but that file was absent. No production source was changed to hide these baseline failures. |
| Full unit suite                     | Not completed successfully. A diagnostic Bun 1.4.0 run produced repeated temporary-Git-process timeouts and was stopped after the failure pattern was established; it is not counted as pinned-runtime verification.       |
| VS Code Extension Host launch smoke | Not run.                                                                                                                                                                                                                   |

The source and build baseline are verified, but the repository does not yet have a fully green unit or Extension Host baseline. Keep the two worktree failures visible until their host dependency or upstream behavior is diagnosed in a focused Cycle.

## CodeM monorepo restructuring

On 2026-09-15 the imported tree was converted to the CodeM target layout:

| Upstream/import path                                                                                                                                                                                                 | Current path or treatment                                                                     | Reason                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `packages/kilo-vscode/`                                                                                                                                                                                              | `apps/vscode/`                                                                                | Editor deliverables are applications.                                                                                            |
| `packages/kilo-jetbrains/`                                                                                                                                                                                           | `apps/jetbrains/`                                                                             | Keep all editor clients under one application boundary.                                                                          |
| `packages/kilo-ui/`                                                                                                                                                                                                  | `packages/ui/`                                                                    | Preserve the current Solid baseline while preventing new product UI from extending it.                                           |
| `packages/ui/`                                                                                                                                                                                                       | `packages/legacy/opencode-ui/`                                                                | Preserve imported OpenCode primitives until the React migration removes their consumers.                                         |
| `packages/kilo-console/`                                                                                                                                                                                             | `packages/legacy/kilo-console/`                                                               | The CLI build embeds this application even though it was not declared as a package dependency.                                   |
| `packages/kilo-web-ui/`                                                                                                                                                                                              | `packages/legacy/kilo-web-ui/`                                                                | Required by the embedded legacy Console; new CodeM UI may not depend on it.                                                      |
| Kilo docs, standalone web application, Storybook workspace, client/codegen workspaces, containers, Zed extension, root release/upstream scripts, plans, specs, translations, Nix files, and Kilo agent configuration | Removed from the working tree; recoverable from the local Trash or the frozen upstream commit | They are outside the retained VS Code/JetBrains build boundary or encode Kilo product/release operations.                        |
| `bun.lock` and root Bun workspace configuration                                                                                                                                                                      | Removed                                                                                       | pnpm 12.4.1 is the sole workspace package manager. Legacy scripts may still use the Bun runtime but may not manage dependencies. |
| `packages/ui/`                                                                                                                                                                                                       | New CodeM React/shadcn package                                                                | Establish the target web design-system boundary without mutating the imported Solid implementation.                              |

The upstream dependency patches that still have consumers were migrated to pnpm `patchedDependencies`. The photon-node patch was regenerated with pnpm because the upstream Bun patch's final hunk did not apply cleanly to pnpm's extracted package. Patches for packages no longer present in the dependency graph were removed.

Post-restructure checks on 2026-09-15: `pnpm install --frozen-lockfile`, CodeM UI typecheck, VS Code Host/Webview typecheck, and VS Code lint passed. The production extension bundle also completed after path migration; its optional compiled CLI step timed out while retrieving upstream model data and used the imported local source-wrapper fallback, so this is not evidence of a distributable VSIX. The full imported unit suite was intentionally not completed in this Cycle after host-sensitive DOM and temporary-Git failures made the workstation unresponsive; no tests were deleted or weakened.

The retained Kilo/OpenCode source tree is now the explicitly approved interaction-compatibility baseline. The VS Code production entry temporarily consumes the mature Solid Webview, Agent Manager, diff/review, editor integrations and Kilo REST/SSE agent transport while the App Server adapter reaches full parity. This exception exists because the earlier reduced React surface dropped user-visible behavior. It ends only when every registered mature interaction has an App Server, editor-Host, or dedicated-service owner and the App Server path passes the parity checks; the final cutover removes the Kilo agent transport rather than keeping a fallback.

## CodeM VS Code identity migration

On 2026-09-15 the VS Code application shell was rebranded without disguising the still-imported runtime boundary:

| Surface             | CodeM identity                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Extension           | publisher `codem`, package `codem`, display name `CodeM`, development version `0.1.11`                                            |
| Public VS Code IDs  | extension `codem.codem`; commands, settings, context keys, panel types, URI handler, and task type under the `codem` namespace    |
| Webview theme       | registered theme and VS Code semantic-token bridge use the single `codem-vscode` identity in light, dark, and high-contrast modes |
| UI and support      | CodeM product copy and icons; repository and issue links point to `linmi/codem-vscode`                                            |
| Development package | versioned as `codem-vscode-<0.1.x>-dev-<target>.vsix`; current source Cycle is `0.1.11`                                           |

Names that still identify an actual imported dependency or migration source—such as `@kilocode/*`, `KiloConnectionService`, `KiloProvider`, `kilo serve`, `.kilo`/`.kilocode`, legacy bot identifiers, upstream URLs, license notices, and migration fixtures—remain factual until the corresponding runtime boundary is replaced. They are not public CodeM aliases or fallback paths.

## Local distributable pruning

The earlier reduced App Server/React build was reversed after it proved that a small package had been obtained by removing mature interactions. The current `0.1.10` preview includes the mature Webview and its required runtime closure, so its size is not a release target. Package pruning resumes only after the 1:1 App Server cutover identifies real dead production consumers; no interaction is removed merely to reduce VSIX size. The target-specific App Server Core, credential broker, hashes, and license files remain in `bin/app-server/`.

## CodeM App Server migration baseline

On 2026-09-15 the App Server migration established the single reusable `packages/app-server` package. It contains both runtime distribution and Host protocol behavior; the short-lived separate `packages/app-server-host` boundary was removed before delivery. The implementation contract is now based on the freshly pulled CodeM `byted/main@d7763f0af4a9152e9dd4ca54ce6f1e56862b798c`; the earlier integration branch remains historical provenance only.

The executable baseline follows the online release instead: `@codem/app-server` pins `@lark-codem/codem-cli@0.1.208` and its declared Core `0.8.37`, then resolves both matching platform packages. App Server still launches the 11,542,064-byte Core directly and avoids the CLI launcher/daemon-service path. The 76,837,346-byte compiled CLI is now staged separately as `codem-auth` because the released Core has no `auth` command and a self-contained VSIX must provide the published credential broker when no user CLI is installed. It is invoked only for `auth status/login/logout`, never as a second live agent transport. The macOS arm64 Core SHA-256 is `1354ec32d4e3ccfb462bc3dd005433a608c3e699b6f839462fe1359cec6b1273`; the auth broker SHA-256 is `0bcc221dc27610bb9e44c8aa1ffa080b2af3f118ba01b4e855b59a347d9a253a`.

Focused runtime, bundle, authentication, preflight, RPC, process-lifecycle, shared Host, environment, thread parameter, correlation, and turn projection tests pass in `@codem/app-server`. Authentication consumes only the published CLI command/event boundary. The Host now covers Core-owned thread history plus live text/reasoning, tool lifecycle and output, tool guards, ordered full file diffs, structured final answers, plan updates, every background-wake phase, hooks, terminal snapshots, HITL and terminal authority. The mature-UI adapter projects those strict DTOs into the existing tool/diff/sub-agent/background-job/hook/prompt-enhancement surfaces. The dead reduced `CodeMProvider` and its separate React Webview were deleted so there is only one user-facing interaction surface during migration. The `0.1.10` preview switches the controller-ready base-chat path to App Server; unsupported live commands fail closed instead of falling back, while non-live Kilo configuration dependencies remain until their protocol gaps close.

The command-side adapter now has complete mappings for the 18 mature UI commands supported by online App Server v1, including Core-owned session creation/history, start/steer/interrupt/compact, HITL, background cancellation, prompt enhancement, skills, model discovery and thread control. The executable parity report accounts for all 264 Webview commands: 206 are editor/dedicated-service owned, the 18 App Server commands are controller-ready, and 40 remain protocol gaps in the pinned online Core. Those gaps include message-scoped resume/delete/revert/redo, background promotion, Kilo suggestions, provider/MCP mutation, memory, indexing, granular sandbox/auto-approval, configuration mutation and durable usage reads. The full production gate remains red while any gap remains.

The default VS Code test entry now runs only the current App Server UI adapter tests. The 416-file imported mature-interaction unit suite remains available through the explicit `test:vscode:legacy` command and is not started implicitly. The obsolete VS Code template Extension Host test, its non-functional compile/watch lifecycle, quickstart file, and dedicated Mocha/Test CLI dependencies were removed; that test asserted only an `Array.indexOf` sample and the active TypeScript configuration already excluded its directory.

The package stages Core, the auth broker, both published licenses, and a schema-2 deterministic manifest into `bin/app-server/`, with independent target, package, version, executable name, and SHA-256 checks. VS Code activation reads broker status and registers `codem.signIn`, `codem.signOut`, `codem.cancelSignIn`, and `codem.refreshAuthentication`; the system-browser authorization page handles both sign-in and new-user registration. Every mature Webview surface routes login, cancellation, logout, refresh, reload, and cross-surface status through that same broker. `@codem/app-server` is `0.1.6`; this Cycle advances the extension to `0.1.10`. The model selector consumes Core's strict `model/list` catalog and the pinned online Core currently reports `codem-router/auto`, presented as `CodeM 智能选择`; thread creation uses the reported active model rather than a hard-coded alias, and the mature selector exposes Core's `low`, `medium`, `high`, and `xhigh` intelligence tiers. Login-required messaging now uses product-neutral CodeM account copy instead of the inherited Kilo Gateway model-count, credit-pricing, and BYOK claims. The first-turn projection keeps the mature Webview's optimistic user message pending until Core history confirms it and reconciles any history snapshot that overlaps an active turn, preventing a stale empty snapshot from erasing both prompt and streamed output. Durable `toolResult` records are accepted as history-only item types, associated with the requested Core turn when the response omits `turnId`, and merged into their matching mature-UI tool call; the same item type can no longer abort terminal snapshots and leave the UI stuck in `Thinking`. The macOS arm64 development artifact is `codem-vscode-0.1.10-dev-darwin-arm64.vsix` (156,759,614 bytes, SHA-256 `06101686f5d44a78b5416f660afbee06ae0d34217e1dd54eba7653df3549818e`).

## Assistant rendering correction (0.1.11)

The installed 0.1.10 Webview raised `Cannot read properties of undefined (reading 'completed')` in the retained text renderer because live assistant DTOs omitted `time`. The CodeM presentation adapter now uses one assistant-message constructor for live and durable history, always supplies `time.created`, and upserts `time.completed` on completed/stopped/failed live terminals without replacing streamed parts or waiting for history. Structured final-answer summaries are ordinary durable assistant text, not synthetic transient status lines, so they remain visible after completion and reload. No legacy renderer behavior or SDK type is weakened.

A focused fixture feeds real adapter events into the actual mature `Part`/Markdown renderer and transcript visibility filter; it reproduced the missing-time crash before the fix. It covers streaming text, live completion, final-answer persistence, and unfinished/completed history. The normal focused VS Code test entry includes this regression and still does not run the imported full unit suite. This Cycle changes only the VS Code presentation boundary; Core, authentication broker, and `@codem/app-server` pins are unchanged.

Verification: 29 focused VS Code tests, Host/Webview typechecks, lint, production bundle, and VSIX archive integrity/identity checks passed. The macOS arm64 artifact is `codem-vscode-0.1.11-dev-darwin-arm64.vsix` (156,759,671 bytes, SHA-256 `a8d0ead3e7f99923896cefefacd091d06416d19a116b3ebfc5723ee87dadbfa8`). Existing staged CLI/SDK/Core assets were reused because this Cycle does not change them. A real authenticated conversation in an installed 0.1.11 Extension Host has not yet been exercised; DOM fixture coverage is not a substitute for that acceptance check.

## Native per-thread permission modes

The user approved replacing the global auto-approve toggle with Core-owned, per-thread `default` / `auto` / `yolo` modes. The old command, setting, boolean Webview messages, editor-side permission auto-replies, bridge and their obsolete tests were removed atomically. The replacement `codem.selectPermissionMode` command focuses the current composer's permission selector; `codem.permissionMode` is only the initial mode for new threads (default `auto`). Existing threads are read from Core, and selecting a mode never changes another thread or the new-thread default. New drafts now show the configured preset and keep edits local until their first submission. Existing threads remain Core-authoritative; failed reads/writes expose an error and a reload action.

`@codem/app-server` now validates exact thread-mode DTOs, connection/thread ownership, monotonic revision and permission epoch, including conflicting duplicate rejection. A Webview write carries the displayed `expectedRevision`; stale choices fail visibly and require reloading Core state rather than silently retrying an outdated choice. Core notifications synchronize every loaded surface, and thread retirement invalidates the displayed state and outstanding UI request identities. The browser-safe `@codem/app-server/modes` export shares the DTO without importing the Node runtime implementation.

Runtime evidence: the pinned Core 0.8.37 returns `{threadId,state:{revision,permissionEpoch,permissionMode,workMode}}`, broadcasts `thread/mode/changed`, and rejects stale writes with code `-32003`, `kind: sessionModeRevisionConflict`. Real Core validation also exposed an existing recovery blocker: `thread/unsubscribe` returns `{status:"unsubscribed"}` or `{status:"notSubscribed"}`, not an empty object. The Host and fixtures now require the published status contract; a negative regression rejects the obsolete empty response. These facts were checked against the installed pinned executable in disposable threads without executing agent turns or tools. Runtime/authentication pins remain unchanged.

The command registry remains 264 entries: 206 Host/dedicated-service entries, 20 controller mappings and 38 explicit protocol gaps. This count is a routing inventory, not end-to-end acceptance. Legacy granular permission rules in the settings/configuration surface are still a separate configuration migration gap; they are not consumed by the new per-thread selector.

Verification for this migration: 45 App Server tests, 35 current VS Code tests, and 52 focused attention/sandbox tests passed. App Server and VS Code Host/Webview typechecks, VS Code lint, production bundle and diff whitespace checks passed. Real Core 0.8.37 mode reads, all three writes, stale-revision rejection and unsubscribe/resume passed. A real VS Code Extension Host loaded the development extension and exercised two controllers sharing the real service/Core, confirming broadcasts, conflict errors, invalidation and restored mode reads. The Extension Host test uses a canonical disposable workspace and performs no agent turn/tool execution; it is not a visual Webview or live tool-approval acceptance test. A separate existing path limitation was observed with macOS `/var` aliases versus Core's canonical `/private/var` cwd; that is not silently normalized by this mode migration.

## Additional component provenance

| Source                                   | Version                                           | Local path                                                                                                                                                                                                 | License             | Use                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shadcn registry `button` (`new-york-v4`) | CLI/registry 4.21.0, retrieved 2026-09-15         | `packages/ui/src/components/button.tsx`                                                                                                                                                                    | MIT                 | Initial checked-in React component source; future additions use the pinned repository command and remain locally owned source.                                                                                                                                                     |
| CodeM desktop application brand assets   | Local CodeM workspace snapshot, reused 2026-09-15 | `apps/vscode/assets/icons/codem.png`, `apps/vscode/assets/icons/codem-*.svg`, `apps/vscode/assets/icons/codem-icon-font.woff2`, `packages/legacy/console/public/codem-logo.svg`, and favicon variants | CodeM project asset | Replaces the imported Kilo marketplace, Activity Bar, command, status bar, Webview empty-state, and embedded Console logos. The SVG variants and icon font are derived from the CodeM node mark; the 1024px product icon comes from `/Users/linmi/Developer/codem/build/icon.png`. |

## Future upstream intake

Do not merge upstream wholesale. Add one row for each approved intake:

| Upstream commit                            | Upstream path                                  | Local path          | License                              | Change and verification                                                                                                                           |
| ------------------------------------------ | ---------------------------------------------- | ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c36e22634860e06e0aa63234fae37bbd83d3b182` | Full tracked tree except documented exclusions | Repository baseline | MIT and included third-party notices | Initial Kilo 7.6.2 import; content, install, typecheck, lint, representative unit tests, and production package build verified as recorded above. |

## CodeM native spaces (2026-09-16)

Added a native VS Code status-bar/QuickPick space selector using the pinned CLI 0.1.208 broker (`project_list`, `space_prepare`, `space_commit`) and Core 0.8.37 process launch binding. No upstream implementation or credential-file reader was copied; the existing Kilo command inventory does not count this new CodeM capability. Preparation, membership validation and the durable account selection remain CLI-owned. Model/skill catalogs come from the selected Core connection. The user explicitly excluded historical space migration during development; reopened sessions use the current selection. Shared package protocol tests, focused service concurrency/failure tests and real Extension Host acceptance cover this path.

## 2026-09-16: remove imported Kilo analytics

Removed `packages/kilo-telemetry`, its PostHog dependency, CLI lifecycle/auth/LLM/tool/suggestion/indexing forwarding, machine identity headers, and the `/telemetry/capture` and `/telemetry/setEnabled` APIs. Regenerated the SDK and removed the obsolete `experimental.openTelemetry` analytics setting. VS Code and JetBrains no longer collect or forward these events; the telemetry-backed answer ratings and TUI rating commands were removed. Editor launchers force `KILO_TELEMETRY_LEVEL=off` for independently distributed legacy CLI binaries until those binaries are replaced. This environment setting is an external-runtime boundary, not a retained local analytics implementation.

Local model/provider usage, completion latency/cost accounting, indexing recovery diagnostics, session export, and separate OpenTelemetry tracing remain. The mature Webview inventory is now 262 commands (204 host/service commands and 58 App Server commands), after removing analytics capture and completion-acceptance reporting. Historical inventory counts above describe earlier checkpoints.

### Composer presets and synchronized permission state

The user approved concrete thinking-effort and approval presets instead of repeatedly loading selector values. The host publishes local `codem.intelligence` / `codem.permissionMode` settings (product defaults `medium` / `auto`) with webview initialization and configuration changes. Thinking selection resolves to an explicit supported effort for both display and submission. Draft permission choices are local, isolated by draft, included in the initial `thread/start`, and preserved for failed-send retries without changing the next draft's default. Existing-thread submissions cannot supply an initial permission override; their changes still require Core revision checks.

The webview session owns permission state across composer remounts and tab switches. The App Server host coalesces concurrent reads and reuses confirmed state, updates it through Core notifications, and invalidates it on thread retirement or failed writes. Restoration reads again; failed reads permit explicit retry. Thinking and permission controls share `PromptOptionSelector`, including keyboard access, focus behavior, popup styling and high-contrast borders. This changes selector initialization and first-send parameters, not the overall Core process startup lifecycle.

Validation: focused App Server and VS Code regressions cover presets, exact first-send parameters, rejected initial overrides, slash commands, draft isolation, read coalescing, failed-read retry, conflicts and retired responses. A real Extension Host with Core 0.8.37 accepted the selected initial permission mode, preserved it while changing thinking effort, and passed cross-surface notification, stale-write and unsubscribe/resume checks. No agent turn or tool was executed in that integration check.

## VS Code voice input removal (2026-09-16)

The user explicitly retired voice input from the VS Code client. Removed the chat,
new-worktree and diff-comment microphone controls, recording shortcuts, prewarm,
model settings/catalog, Host recording/transcription code and Webview messages.
Deleted the FFmpeg download helper and both packaging callers; `.vscodeignore`
excludes old FFmpeg binaries when packaging from an existing output tree.
The five old inbound commands are no longer in the ownership registry; negative
regressions prevent their reintroduction. Text input, attachments and review
comments remain. Historical changelog entries and the imported backend/SDK used
by other consumers are retained; this cycle does not retire the Kilo runtime.

## Stop bundling the transitional Kilo runtime (2026-09-16)

The user authorized shipping an incomplete development package before all legacy
features are adapted. VSIX `bin/` now includes only `bin/app-server/`; retained
local Kilo binaries, Tree-sitter resources and sandbox helpers cannot leak into
the artifact. The normal package task no longer prepares Kilo. The multi-target
builder stages the pinned CodeM runtime and broker for the six supported targets,
without an imported CLI build directory. Missing legacy runtime use reports the
unmigrated feature instead of instructing users to restore Kilo.

Source-development launch scripts and legacy consumers remain migration input,
with deletion deferred until their functionality is adapted. This does not
claim a completed production transport cutover. Packaging regressions cover
stale POSIX/Windows binaries and preservation of CodeM binaries and licenses.

## Core JSONL history recovery (2026-09-16)

`packages/session-history/src/shared/` selectively imports the record reducer and its transitive domain dependencies from CodeM Desktop `main@d7763f0af4a9152e9dd4ca54ce6f1e56862b798c`: `packages/cli-adapter/src/records/schema.ts`, required record handlers, and required `session` / `diff` modules. Only consumed barrel exports are retained; package imports become local relative `.ts` imports. The source contains no separate license files or notices in these imported paths.

The only semantic changes within imported source are: the visitor exposes the reducer's existing initial-submission identity, and the host-supported JSONL version is explicitly restricted to schema 13. Published Core 0.8.37 writes schema 13 (verified in the real VS Code session header); the previous plan's schema 12 statement was stale. The shared schema-13 decoder preserves persisted legacy *record variants within that schema*, synthetic-input suppression, clear cutoffs, code rewind markers, record sequencing and tool correlation. These are durable protocol semantics, not a second decoder or legacy agent transport.

The public host wrapper supplies safe session discovery, snapshot-bound pagination, cancellation, and hash-verified tool blob hydration. It stores no durable transcript or SQLite index. It streams the shared reducer and retains only the requested turn window; a future index must remain rebuildable from the same decoder. Realtime remains the exact published CLI/Core pin. Old history RPC methods and development-Core override were removed atomically from the plugin.

## Solid `@codem/ui` absorption (2026-09-17)

The 2026-09-15 shadcn React stub in `packages/ui/` was removed. The imported Solid tree previously at `packages/legacy/kilo-ui/` is now the `@codem/ui` package. Production imports use `@codem/ui/components/<name>`, `@codem/ui/context/*`, `@codem/ui/theme`, and `@codem/ui/styles`. The `@kilocode/kilo-ui` package name and shadcn CLI (`ui:add`, root `shadcn` dependency, `components.json`) were deleted rather than kept as aliases.

## Solid OpenCode primitives absorbed into `@codem/ui` (2026-09-17)

`packages/legacy/opencode-ui` (`@opencode-ai/ui`) was merged into `packages/ui`. CodeM overlay files (`message-part`, `icon`, `select`, `basic-tool`, theme defaults, overlay CSS) were kept; pure re-exports were replaced with the real source. Callers now import `@codem/ui` only. The `@opencode-ai/ui` package name was deleted rather than kept as an alias. Historical rows above that mention a standalone `packages/legacy/opencode-ui` describe the superseded package, not the current tree.

## Console widgets and kilo-i18n absorbed into `@codem/ui` (2026-09-17)

`packages/legacy/kilo-web-ui` (`@kilocode/kilo-web-ui`) and `packages/kilo-i18n` (`@kilocode/kilo-i18n`) were merged into `packages/ui`. Unique Console widgets and styles live at `@codem/ui/components/*` and `@codem/ui/styles/console`. Shared override strings were folded into `@codem/ui/i18n/*`. Public kilo theme tokens, font variables, scrollbar class, Pierre/Shiki theme name, favicon title, and pass-meter identifiers were renamed to CodeM. Highlight callers now request `DIFF_THEME` (`"CodeM"`) only. The old package names were deleted rather than kept as aliases. Historical rows above that mention a standalone `packages/legacy/kilo-web-ui` describe the superseded package, not the current tree. `packages/legacy/console` (`@codem/console`) is the CLI Console application path; the previous `kilo-console` / `@kilocode/kilo-console` names were deleted rather than kept as aliases.
