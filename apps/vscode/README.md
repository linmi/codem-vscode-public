# CodeM for VS Code

CodeM brings the CodeM coding-agent experience into VS Code through the Activity Bar, editor tabs, context actions, diff and review surfaces, conversation history, and Agent Manager workflows.

> This package is an internal development preview. The editor shell now uses CodeM branding and public VS Code identifiers, while the runtime migration to `codem app-server` is still in progress. Do not treat this build as a production CodeM release.

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

The executable product and protocol contract is documented in [`../../vscode-plugin-plan.md`](../../vscode-plugin-plan.md). Shared React/shadcn components belong in `packages/ui`; the retained SolidJS webview and legacy backend packages are migration inputs only.

## License and provenance

CodeM preserves the license and copyright notices required by the Kilo Code and OpenCode source used as the frozen migration baseline. See [`../../UPSTREAM_KILOCODE.md`](../../UPSTREAM_KILOCODE.md), [`LICENSE`](LICENSE), and [`THIRD_PARTY_LICENSES`](THIRD_PARTY_LICENSES).
