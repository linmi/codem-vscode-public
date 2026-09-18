# VS Code application instructions

Read the repository-root [`AGENTS.md`](../../AGENTS.md), [`vscode-plugin-plan.md`](../../vscode-plugin-plan.md), and [`UPSTREAM.md`](../../UPSTREAM.md) first. Root product invariants and migration rules are authoritative.

## Status and scope

- This directory is the imported Kilo 7.6.2 VS Code baseline with a CodeM-branded shell and public `codem.*` identifiers. Source version is `0.1.14`. It is not a finished CodeM extension.
- Controller-ready chat (42 Webview commands) goes through `@codem/app-server`. The catalog/mode path is UI-adapts-to-App-Server: Host posts `codemModelsLoaded` / `codemSkillsLoaded` / `threadModes*` and CodeM control-plane result DTOs, not Kilo `providersLoaded` / `commandsLoaded` / `agentsLoaded`. Activation still constructs `KiloConnectionService` for leftover Host coordination, but `connect()` / `getServer()` fail closed and never spawn `kilo serve`. Unmigrated `app-server-control` commands report `尚未迁移到 CodeM App Server` instead of falling through to Kilo.
- The executable parity inventory is 277 commands: 199 host/service, 42 App Server controllers, 36 Core v1 gaps. The production gate is red until the gaps close and Kilo is deleted atomically.
- Preserve useful VS Code surfaces while migrating the runtime and product model to CodeM App Server.
- Do not extend Kilo REST/SSE, `kilo serve`, Kilo Session/provider stores, Gateway behavior, Kilo branding, or old command/view IDs for new CodeM work.
- Keep each migration Cycle independently verifiable. When a boundary is migrated, update all production callers, contracts, tests, paths, and imports, then delete the superseded path.

## Current map

- `src/extension.ts`: activation; creates both `CodeMAppServerService` and `KiloConnectionService`.
- `src/services/app-server/`: CodeM Host adapter, mature UI controller, ownership registry, space selector, credential-broker UI.
- `src/services/cli-backend/`: imported Kilo process and transport boundary; migration source, not target architecture.
- `src/kilo-provider/` and `src/CodeMProvider.ts`: current host/webview coordination; App Server messages are handled first.
- `src/agent-manager/`: worktree, terminal, Git, and Agent Manager host integration; still Kilo-backed.
- `webview-ui/`: current SolidJS webview implementation.
- `tests/unit/`: package unit tests; run only focused files relevant to the current Cycle.
- `tests/host/`: tests and fixtures relocated from the Host source tree. The default test command selects its App Server suite; imported Vitest suites retain their existing runner requirements and are excluded from Playwright discovery.
- `tests/extension-host/`: real Extension Host acceptance (login required). Repeat with `pnpm --dir apps/vscode run test:extension-host`. The no-login fixture for the same cycle is `tests/host/services/app-server/acceptance-cycle.test.ts`.
- `script/`: local build, SDK generation, launch, and packaging scripts.

## UI boundary

- New CodeM web UI belongs in the Solid package at `packages/ui` and is imported through `@codem/ui` exports such as `@codem/ui/components/button` and `@codem/ui/types/session`. Webview and Host production source must not import `@kilocode/sdk`. Transcript Session/Message/Part types come from `@codem/ui/types/session`. Leftover `KiloClient`, Event, Config, and session-import DTOs live in `src/services/cli-backend/leftover-sdk.ts`; `createKiloClient` fail-closes.
- Packages under `packages/legacy` are CLI Console build inputs. Do not add new product UI to them.
- Do not introduce shadcn or a second React webview stack.
- Keep VS Code-specific theme adapters, CSP, editor messaging, and lifecycle code in this app. Keep reusable tokens and components in `packages/ui`.
- Preserve keyboard access, focus visibility, reduced motion, high contrast, and strict Webview CSP.

## Host boundaries

- Extension Host owns child processes, VS Code APIs, workspace trust, path validation, subscriptions, pending RPC state, and SecretStorage.
- Webviews consume strict product DTOs only. Catalog and mode surfaces import `@codem/protocol` (`packages/protocol`) and use CodeM native messages (`codemModelsLoaded` / `codemSkillsLoaded` / `threadModes*`). Never expose raw App Server frames, secrets, environment dumps, arbitrary filesystem paths, or process handles.
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

The default VS Code gate uses Node: `pnpm test:vscode` is `node --test --experimental-strip-types`, and typecheck/bundle are `tsc` / `node esbuild.js`. Prepare, package, launch, watch, and Extension Host also run through Node (`node --experimental-strip-types script/*.ts`). Leftover Kilo CLI staging (`prepare:cli-binary`, `watch:cli`) and `test:vscode:legacy` may still invoke the pinned Bun binary. They may not install dependencies or create a Bun lockfile. Worktree setup uses `pnpm install --frozen-lockfile`.

Do not run the full imported unit suite by default. When tests are in scope, choose the smallest relevant test files and report host-sensitive failures without weakening or deleting assertions.

## Generated and upstream code

- Do not edit `packages/sdk/js/src/gen` or `packages/sdk/js/src/v2/gen` by hand.
- Do not commit `dist`, `out`, `bin`, `.artifacts`, Storybook output, IDE caches, or dependency directories.
- Preserve license and copyright notices for copied Kilo, OpenCode, and third-party code.
- Record any material upstream intake or removal in `UPSTREAM.md`.
