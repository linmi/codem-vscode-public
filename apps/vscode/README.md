# CodeM for VS Code

CodeM is adapting the mature imported VS Code interaction surface to CodeM Core and its App Server protocol.

> This package is an internal migration preview. The current `0.1.14` checkout keeps the mature Solid Webview, Agent Manager, diff/review, editor actions, and dedicated Autocomplete surface active. The 21 controller-ready base-chat commands use `codem app-server` with the shared CodeM credential broker; the model selector exposes Core's `low`, `medium`, `high`, and `xhigh` intelligence tiers. Slash commands come from Core `skills/list`. Unsupported `app-server-live` commands fail explicitly instead of falling back to Kilo. Opening the Sidebar still starts `kilo serve` for Autocomplete, Agent Manager, and unmigrated configuration. The 1:1 parity gate remains red.

## Development

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm test:vscode
pnpm typecheck:vscode
pnpm lint:vscode
pnpm build:vscode
```

`pnpm test:vscode` runs only the current App Server UI adapter tests. The retained imported interaction suite is available explicitly as `pnpm test:vscode:legacy`; it is intentionally excluded from the default path because it contains hundreds of host-sensitive tests.

The packaged extension identity is `codem.codem`. Commands, views, context keys, and settings use the `codem.*` namespace.

## Architecture

The executable product and protocol contract is documented in [`../../vscode-plugin-plan.md`](../../vscode-plugin-plan.md). Shared Solid components belong in `packages/ui` and are imported as `@codem/ui/components/*`. `@codem/app-server` owns the reusable Core runtime and strict Host protocol. The temporary mature-UI adapter projects those CodeM DTOs into the existing Webview vocabulary; it never forwards raw RPC frames. The discarded reduced `CodeMProvider` Webview is not part of the build: the mature Sidebar/Open in Tab/Agent Manager surface is the only UI migration target. The final cutover removes the Kilo agent transport atomically, while editor-owned interactions and dedicated Autocomplete remain real services.

The production parity gate accounts for all **257** Webview inbound commands: 199 remain real editor/dedicated-service commands, 21 have complete App Server v1 controller mappings, and 37 are explicit online Core v1 protocol gaps. This preview enables the controller-ready base path. `app-server-control` gaps still fall through to Kilo. The full gate remains red until every gap is resolved and the Kilo transport is deleted.

## License and provenance

CodeM preserves the license and copyright notices required by the Kilo Code and OpenCode source used as the frozen migration baseline. See [`../../UPSTREAM.md`](../../UPSTREAM.md), [`LICENSE`](LICENSE), and [`THIRD_PARTY_LICENSES`](THIRD_PARTY_LICENSES).
