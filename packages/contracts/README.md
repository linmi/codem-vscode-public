# @codem/contracts

Cross-language contract samples for CodeM hosts. This package records verified wire, Webview and history shapes. It is not a runtime service and must not invent Core methods.

## Contents

- `manifest.json` — format, pinned Core/CLI/schema baselines
- `core/` — initialize, RPC, notification and interaction sequences
- `webview/` — host/UI message samples and schemas
- `history/` — JSONL fixtures and expected projections

Each sample has a unique `id`, capability id, versions, provenance, input/event order and expected result or error class. Samples contain no credentials, user history or private absolute paths. Temporary roots are parameters.

TypeScript tests consume these files through `workspace:*`. Gradle declares the same directories as test inputs; users do not need npm at runtime. Production UI must not bundle the sample tree.

## Versions

`manifest.json` is the machine-readable baseline for new consumers. Node App Server still resolves binaries from `packages/app-server/src/runtime.ts`. Default tests require the two sources to match.
