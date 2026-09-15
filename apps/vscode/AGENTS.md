# VS Code application instructions

Read the repository-root [`AGENTS.md`](../../AGENTS.md), [`vscode-plugin-plan.md`](../../vscode-plugin-plan.md), and [`UPSTREAM_KILOCODE.md`](../../UPSTREAM_KILOCODE.md) first. Root product invariants and migration rules are authoritative.

## Status and scope

- This directory is the imported Kilo 7.6.2 VS Code baseline with a CodeM-branded shell and public `codem.*` identifiers; its runtime is not yet a completed CodeM extension.
- Preserve useful VS Code surfaces while migrating the runtime and product model to CodeM App Server.
- Do not extend Kilo REST/SSE, `kilo serve`, Kilo Session/provider stores, Gateway behavior, Kilo branding, or old command/view IDs for new CodeM work.
- Keep each migration Cycle independently verifiable. When a boundary is migrated, update all production callers, contracts, tests, paths, and imports, then delete the superseded path.

## Current map

- `src/extension.ts`: activation and shared host services.
- `src/services/cli-backend/`: imported Kilo process and transport boundary; migration source, not target architecture.
- `src/kilo-provider/` and `src/KiloProvider.ts`: current host/webview coordination.
- `src/agent-manager/`: worktree, terminal, Git, and Agent Manager host integration.
- `webview-ui/`: current SolidJS webview implementation.
- `tests/unit/`: package unit tests; run only focused files relevant to the current Cycle.
- `script/`: local build, SDK generation, launch, and packaging scripts.

## UI boundary

- New CodeM web UI belongs in the React/shadcn package at `packages/ui` and is imported through `@codem/ui` exports.
- The current Solid webview and packages under `packages/legacy` are behavioral references and temporary build inputs. Do not add new product UI to them.
- Switch a complete webview entry point and its build configuration in one approved React migration Cycle. Do not create a permanent React/Solid compatibility layer.
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
- Record any material upstream intake or removal in `UPSTREAM_KILOCODE.md`.
