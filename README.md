# CodeM editor clients

CodeM's editor integrations are organized as a pnpm monorepo.

```text
apps/
  vscode/       VS Code extension
  jetbrains/    JetBrains plugin
packages/
  app-server/      reusable Core runtime, packaging, integrity, and host protocol
  ui/           React + shadcn design system
  legacy/       transitional SolidJS UI and CLI Console build inputs
  ...           temporary Kilo/OpenCode build dependencies
```

## Setup

```bash
pnpm install --frozen-lockfile
pnpm typecheck
```

Common commands:

```bash
pnpm dev:vscode
pnpm build:vscode
pnpm package:vscode:dev
pnpm typecheck:vscode
pnpm lint:vscode
pnpm test:app-server
pnpm typecheck:app-server
pnpm typecheck:ui
```

The current VS Code and JetBrains sources were imported from the Kilo snapshot recorded in [`UPSTREAM_KILOCODE.md`](UPSTREAM_KILOCODE.md). They are migration baselines and still contain Kilo runtime and UI paths. The target architecture is defined in [`vscode-plugin-plan.md`](vscode-plugin-plan.md).

App Server migration has started in `packages/app-server`, the single reusable editor-neutral package for both runtime distribution and Host protocol behavior. It pins the online CLI 0.1.208 Core line at 0.8.37 and owns platform resolution, license staging, deterministic bundle metadata, integrity checks, and strict initialize preflight. VS Code build, debug, snapshot, and dev-package preparation stage the current platform Core under `apps/vscode/bin/app-server`; the resulting VSIX does not require a separately installed CodeM CLI. The published response currently omits the JSON-RPC `jsonrpc` member; the package records that explicit compatibility state while rejecting every non-2.0 value. The bundled Core is not wired into the VS Code production chat path yet, so Kilo remains the factual imported runtime until the live host Cycle performs an atomic cutover.

pnpm is the only dependency manager. The imported build scripts still use the repository-pinned Bun 1.3.14 binary as a TypeScript runtime; it does not own workspace installation or locking.
