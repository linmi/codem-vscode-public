# CodeM for VS Code

CodeM brings CodeM Core into VS Code through an App Server-native Activity Bar and chat surface.

> This package is an internal development preview. Its only live agent transport is `codem app-server` over stdio JSON-RPC; it has no Kilo REST/SSE fallback.

## Development

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm typecheck:vscode
pnpm lint:vscode
pnpm build:vscode
```

The packaged extension identity is `codem.codem`. Commands, views, context keys, and settings use the `codem.*` namespace.

## Architecture

The executable product and protocol contract is documented in [`../../vscode-plugin-plan.md`](../../vscode-plugin-plan.md). Shared React/shadcn components belong in `packages/ui`. The production bundle contains one React Webview and the reusable `@codem/app-server` Host; retained Kilo/Solid source is migration reference only and is excluded from the package dependency and build closure.

## License and provenance

CodeM preserves the license and copyright notices required by the Kilo Code and OpenCode source used as the frozen migration baseline. See [`../../UPSTREAM_KILOCODE.md`](../../UPSTREAM_KILOCODE.md), [`LICENSE`](LICENSE), and [`THIRD_PARTY_LICENSES`](THIRD_PARTY_LICENSES).
