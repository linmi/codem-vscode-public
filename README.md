# CodeM editor clients

CodeM's editor integrations are organized as a pnpm monorepo.

```text
apps/
  vscode/              VS Code extension
  jetbrains/           JetBrains plugin (not yet on App Server)
packages/
  app-server/          reusable Core runtime, packaging, integrity, and host protocol
  protocol/            isomorphic catalog/mode DTOs (`@codem/protocol`) for Host and Webview
  session-history/     Core JSONL schema 13 durable history
  ui/                  Solid design system (`@codem/ui`)
  legacy/console/      CLI Console application
  ...                  temporary Kilo/OpenCode build dependencies
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
pnpm test:protocol
pnpm typecheck:protocol
pnpm test:app-server
pnpm typecheck:app-server
pnpm typecheck:ui
```

The current VS Code and JetBrains sources were imported from the Kilo snapshot recorded in [`UPSTREAM.md`](UPSTREAM.md). They are migration baselines and still contain Kilo runtime paths. The product contract is [`vscode-plugin-plan.md`](vscode-plugin-plan.md).

`packages/app-server` is the single reusable editor-neutral package for runtime distribution and Host protocol. It pins CLI 0.1.208 / Core 0.8.37 and owns platform resolution, license staging, bundle integrity, JSON-RPC, connection pooling by `cwd`, and thread/turn lifecycle. VS Code stages the current platform Core under `apps/vscode/bin/app-server`; the VSIX does not require a separately installed CodeM CLI. Published Core responses omit `jsonrpc`; the package accepts only omission or exact `"2.0"`.

VS Code `0.1.14` already routes the 21 controller-ready chat commands through App Server. Activation no longer starts `kilo serve`; unmigrated surfaces fail closed with `尚未迁移到 CodeM App Server`. The 257-command parity gate is red (37 Core v1 gaps). JetBrains does not import `@codem/app-server`. This is not an atomic production cutover.

pnpm is the only dependency manager. The imported build scripts still use the repository-pinned Bun 1.3.14 binary as a TypeScript runtime; it does not own workspace installation or locking.
