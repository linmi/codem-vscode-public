# AGENTS.md

## Mission

This repository builds CodeM editor clients as a pnpm monorepo. The frozen Kilo snapshot in [`UPSTREAM.md`](UPSTREAM.md) is migration input, not the target product. [`vscode-plugin-plan.md`](vscode-plugin-plan.md) is the product and protocol contract.

## Current Phase

- Editor applications live under `apps/`.
- Shared CodeM packages live under `packages/`.
- Imported packages that remain necessary only for the Kilo baseline are transitional legacy dependencies. Do not add new CodeM behavior to them.
- The VS Code shell, manifest, public commands, views, settings, task type, visible product copy, and distributable filename use the CodeM brand and `codem.*` namespace. Legacy Kilo names may remain only where they truthfully identify the imported runtime, protocol, migration inputs, or retained licensed source.
- The VS Code webview is SolidJS and imports shared components from `@codem/ui`. Do not describe the current checkout as a finished CodeM extension: the controller-ready chat path uses App Server, but activation still starts Kilo REST/SSE, and `assertMatureUiProductionReady()` is red (257 commands / 21 controllers / 37 protocol gaps).
- Online CLI 0.1.208 binds Core 0.8.37. `packages/app-server` owns that exact runtime pin, distributable artifact contract, and host protocol boundary. Connection pooling is keyed by canonical `cwd`; permission mode is per-thread. App Server responses currently omit the `jsonrpc` member; the package may accept only omission or the exact value `"2.0"`, must expose which shape was observed, and must reject every other value. Delete the omission exception when the pinned online runtime emits the field.
- Durable history is `packages/session-history` reading Core JSONL schema 13. Do not add a second transcript store or restore `thread/turns/list` as a history source.
- Work in one independently verifiable Cycle at a time. Do not combine unrelated dependency upgrades or speculative abstractions with a migration Cycle.

## Product Invariants

- CodeM has one agent live transport: `codem app-server` over newline-delimited JSON-RPC 2.0 on stdio.
- CodeM Core assigns and owns `threadId`. Core JSONL is the only durable conversation-history authority.
- Editor hosts own child-process lifecycle, authentication, filesystem access, editor APIs, path validation, subscriptions, and pending RPC state.
- Webviews consume strict CodeM DTOs only. They must not receive raw App Server frames, secrets, environment dumps, unrestricted filesystem paths, or child-process handles.
- Notifications and client requests are correlated by connection identity, `threadId`, `turnId`, and the applicable `requestId` or `submissionId`. Unknown, stale, duplicated, or cross-thread messages have no authority.
- `turn/completed` is the live terminal authority. Durable projection may settle later but cannot keep a completed UI run active or reverse its terminal result.
- Workspace Trust is required before starting Core, reading workspace content, executing tools, or running setup scripts.
- Protocol, capability, runtime, or required-platform mismatches fail closed with actionable diagnostics.
- Secrets belong in the editor's approved secret store or the CodeM credential broker, never in webview state, workspace configuration, logs, telemetry, fixtures, or transcripts.

## Monorepo Layout

- `apps/vscode/`: imported VS Code application and primary migration surface.
- `apps/jetbrains/`: imported JetBrains application. It uses native IntelliJ UI; `@codem/ui` applies to web surfaces, not Swing/Jewel screens.
- `packages/app-server/`: reusable Node-only CodeM Core version, platform resolution, extension staging, license, bundle-integrity, protocol, and lifecycle boundary. It may not depend on editor APIs, Electron, VS Code, or DOM APIs. VS Code consumes it; JetBrains does not yet.
- `packages/session-history/`: Node-only JSONL schema 13 history reader shared by editor hosts.
- `packages/ui/`: CodeM Solid design-system source, including the absorbed OpenCode primitives and CLI Console widgets. VS Code webviews import it as `@codem/ui/components/*`.
- `packages/legacy/console/`: imported CLI Console application (`@codem/console`). It imports shared widgets from `@codem/ui`.
- `packages/opencode/`, `packages/sdk/js/`, and remaining Kilo/OpenCode packages: temporary build closure for the imported backend. Remove them when App Server migration has deleted their production consumers.
- `pnpm-workspace.yaml`: workspace and catalog authority.
- `pnpm-lock.yaml`: the only JavaScript dependency lockfile.

## UI Rules

- New CodeM web UI uses SolidJS and components owned under `packages/ui/`.
- Import shared UI through explicit exports such as `@codem/ui/components/button`; do not reach into another package's `src/` tree.
- Do not add new product UI to `packages/legacy`. Do not introduce shadcn, React webview, or a second design-system package.
- Keep editor-specific adapters and VS Code theme integration in `apps/vscode`; keep reusable tokens and components in `packages/ui`.
- Preserve keyboard access, focus visibility, reduced motion, high contrast, and VS Code Webview CSP.

## Package Manager and Runtime

- pnpm 12.4.1 is the sole workspace package manager. Do not add npm, Yarn, or Bun lockfiles.
- Use `workspace:*` for internal packages and keep versions in the pnpm catalog when they are intentionally shared.
- Some imported build and test scripts still execute TypeScript with Bun. Bun is a temporary legacy runtime dependency, not a second package manager. Do not use `bun install`, `bun add`, or regenerate `bun.lock`.
- New repository automation should run through pnpm. Replace a legacy Bun script when its owning production path is migrated; do not rewrite unrelated legacy tooling in advance.

## Superseded Kilo Paths

The following are reproducibility facts, not accepted target architecture: `KiloConnectionService`, `ServerManager`, `kilo serve`, `@kilocode/sdk`, REST/SSE transport, Kilo Session stores, Gateway authentication, provider routing, Cloud Agent, Cloud Review, and Kilo branding.

When a migration Cycle touches one of these boundaries, update all production callers, types, tests, documentation, paths, and imports, then delete the old entry. Do not retain optional aliases, dual transports, dual reads/writes, or silent App Server fallbacks.

## Working Rules

1. Before editing, inspect `git status`, relevant production paths, types, callers, tests, package instructions, and actual runtime versions.
2. Distinguish current imported behavior, CodeM invariants, migration-only state, and unresolved product decisions.
3. Preserve user changes in a dirty worktree. Do not discard or overwrite unrelated edits.
4. Keep generated output and dependency directories out of source control.
5. Preserve Kilo, OpenCode, and third-party license notices for retained code.
6. Record material upstream intake and pruning in `UPSTREAM.md`.
7. Do not create commits or push unless the user explicitly requests it for the current task.

## Validation

Keep tests, test-only helpers, fixtures, and snapshots under each workspace package's root `tests/` directory. Preserve domain subdirectories. VS Code host tests live in `apps/vscode/tests/host/`; JetBrains Gradle modules use `apps/jetbrains/tests/<module>/kotlin` and `resources` through explicit test source sets.

Install from the repository root:

```bash
pnpm install --frozen-lockfile
```

Run the smallest relevant checks first:

```bash
pnpm test:app-server
pnpm typecheck:app-server
pnpm typecheck:ui
pnpm typecheck:vscode
pnpm lint:vscode
pnpm build:vscode
```

The imported VS Code unit suite uses Bun internally. A historical baseline run has recorded host-sensitive worktree failures; do not weaken or delete assertions to claim a pass. Run that suite only when its behavior is in scope. For App Server changes, also verify success, rejection, retry, duplicate/stale/out-of-order events, cancellation, crash, reload, shutdown, interaction resolution, history reconstruction, path safety, secrets, and actual Extension Host execution.

## Git and Delivery

- Keep each commit scoped to one Cycle and create it only when explicitly requested.
- Push only with explicit authorization.
- Deliver the result, verification, and remaining blockers first.
