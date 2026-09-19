# CodeM for VS Code

CodeM is adapting the mature imported VS Code interaction surface to CodeM Core and its App Server protocol.

> This package is an internal migration preview. The current `0.1.14` checkout keeps the mature Solid Webview, Agent Manager, diff/review, editor actions, and dedicated Autocomplete surface active. The 42 controller-ready App Server commands use `codem app-server` with the shared CodeM credential broker; the model selector, Skills, slash menu, and Host control-plane snapshots consume Core `codemModelsLoaded` / `codemSkillsLoaded` / CodeM result DTOs. Unsupported App Server commands and leftover Kilo surfaces fail closed with `尚未迁移到 CodeM App Server`. Activation does not start `kilo serve`. The 1:1 parity gate remains red.

## Development

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm test:vscode
pnpm typecheck:vscode
pnpm lint:vscode
pnpm build:vscode
```

`pnpm test:vscode` runs the current App Server UI adapter tests, Webview leftover-SDK gate, and production-script checks on Node (`node --test --experimental-strip-types`). `pnpm package:vscode:dev` and `pnpm dev:vscode` also stay on Node. The retained imported interaction suite is available explicitly as `pnpm test:vscode:legacy` (still Bun); leftover Kilo CLI staging (`prepare:cli-binary`) is not part of the production package path.

The packaged extension identity is `codem.codem`. Commands, views, context keys, and settings use the `codem.*` namespace.

## Architecture

The executable product and protocol contract is documented in [`../../vscode-plugin-plan.md`](../../vscode-plugin-plan.md). Shared Solid components belong in `packages/ui` and are imported as `@codem/ui/components/*`. Timeline Message/Part types come from `@codem/ui/types/session`. `@codem/app-server` owns the reusable Core runtime and strict Host protocol. Catalog and mode DTOs come from `@codem/protocol` (`packages/protocol`); the adapter never forwards raw RPC frames. The discarded reduced `CodeMProvider` Webview is not part of the build: the mature Sidebar/Open in Tab/Agent Manager surface is the only UI migration target. The final cutover removes the Kilo agent transport atomically, while editor-owned interactions and dedicated Autocomplete remain real services.

The production parity gate accounts for all **277** Webview inbound commands: 199 remain real editor/dedicated-service commands, 42 have complete App Server v1 controller mappings, and 36 are explicit online Core v1 protocol gaps. This preview enables the controller-ready base path. `app-server-control` gaps fail closed with `尚未迁移到 CodeM App Server`. The full gate remains red until every gap is resolved and the Kilo transport is deleted.

## License and provenance

CodeM preserves the license and copyright notices required by the Kilo Code and OpenCode source used as the frozen migration baseline. See [`../../UPSTREAM.md`](../../UPSTREAM.md), [`LICENSE`](LICENSE), and [`THIRD_PARTY_LICENSES`](THIRD_PARTY_LICENSES).
