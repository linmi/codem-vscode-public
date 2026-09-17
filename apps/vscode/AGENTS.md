# VS Code application instructions

Read the repository-root [`AGENTS.md`](../../AGENTS.md), [`vscode-plugin-plan.md`](../../vscode-plugin-plan.md), and [`UPSTREAM.md`](../../UPSTREAM.md) first. Root product invariants and migration rules are authoritative.

## Status and scope

- This directory is the imported Kilo 7.6.2 VS Code baseline with a CodeM-branded shell and public `codem.*` identifiers. Source version is `0.1.14`. It is not a finished CodeM extension.
- Controller-ready chat (21 Webview commands) goes through `@codem/app-server`. Activation still constructs `KiloConnectionService` and opening a Sidebar still starts `kilo serve` for unmigrated surfaces. `app-server-control` protocol gaps currently fall through to Kilo; do not add new callers there.
- The executable parity inventory is 257 commands: 199 host/service, 21 App Server controllers, 37 Core v1 gaps. The production gate is red until the gaps close and Kilo is deleted atomically.
- Preserve useful VS Code surfaces while migrating the runtime and product model to CodeM App Server.
- Do not extend Kilo REST/SSE, `kilo serve`, Kilo Session/provider stores, Gateway behavior, Kilo branding, or old command/view IDs for new CodeM work.
- Keep each migration Cycle independently verifiable. When a boundary is migrated, update all production callers, contracts, tests, paths, and imports, then delete the superseded path.

## Current map

- `src/extension.ts`: activation; creates both `CodeMAppServerService` and `KiloConnectionService`.
- `src/services/app-server/`: CodeM Host adapter, mature UI controller, ownership registry, space selector, credential-broker UI.
- `src/services/cli-backend/`: imported Kilo process and transport boundary; migration source, not target architecture.
- `src/kilo-provider/` and `src/KiloProvider.ts`: current host/webview coordination; App Server messages are handled first.
- `src/agent-manager/`: worktree, terminal, Git, and Agent Manager host integration; still Kilo-backed.
- `webview-ui/`: current SolidJS webview implementation.
- `tests/unit/`: package unit tests; run only focused files relevant to the current Cycle.
- `tests/host/`: tests and fixtures relocated from the Host source tree. The default test command selects its App Server suite; imported Vitest suites retain their existing runner requirements and are excluded from Playwright discovery.
- `tests/extension-host/`: real Extension Host acceptance (login required).
- `script/`: local build, SDK generation, launch, and packaging scripts.

## UI boundary

- New CodeM web UI belongs in the Solid package at `packages/ui` and is imported through `@codem/ui` exports such as `@codem/ui/components/button`.
- Packages under `packages/legacy` are CLI Console build inputs. Do not add new product UI to them.
- Do not introduce shadcn or a second React webview stack.
- Keep VS Code-specific theme adapters, CSP, editor messaging, and lifecycle code in this app. Keep reusable tokens and components in `packages/ui`.
- Preserve keyboard access, focus visibility, reduced motion, high contrast, and strict Webview CSP.

## Host boundaries

- Extension Host owns child processes, VS Code APIs, workspace trust, path validation, subscriptions, pending RPC state, and SecretStorage.
- Webviews consume strict product DTOs only. Never expose raw App Server frames, secrets, environment dumps, arbitrary filesystem paths, or process handles.
- On Windows, spawn child processes through the wrappers in `src/util/process.ts` or explicitly set `windowsHide: true`.
- Do not raise Agent Manager file-size caps. Extract VS Code-free helpers when a changed file would exceed its enforced cap.

## Commands

Run commands from the repository root through pnpm:

```bash
pnpm dev:vscode
pnpm dev:vscode:isolated
pnpm typecheck:vscode
pnpm lint:vscode
pnpm build:vscode
```

Imported scripts may invoke the pinned Bun binary as a TypeScript runtime. They may not install dependencies or create a Bun lockfile. Worktree setup uses `pnpm install --frozen-lockfile`.

Do not run the full imported unit suite by default. When tests are in scope, choose the smallest relevant test files and report host-sensitive failures without weakening or deleting assertions.

## Generated and upstream code

- Do not edit `packages/sdk/js/src/gen` or `packages/sdk/js/src/v2/gen` by hand.
- Do not commit `dist`, `out`, `bin`, `.artifacts`, Storybook output, IDE caches, or dependency directories.
- Preserve license and copyright notices for copied Kilo, OpenCode, and third-party code.
- Record any material upstream intake or removal in `UPSTREAM.md`.
