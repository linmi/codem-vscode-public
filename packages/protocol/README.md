# @codem/protocol

Isomorphic CodeM catalog and thread-mode DTOs shared by hosts and interfaces. No runtime dependencies, Node, editor, Electron or DOM APIs.

App Server owns raw-frame parsing and re-exports identical public types from this package. Applications own their host-to-interface message boundary and whitelist copied fields.

```ts
import type { CodemModelCatalog, CodemModeState, CodemSkillSummary } from "@codem/protocol"
import { CODEM_BUILTIN_INTELLIGENCE_TIERS, parseCodemPermissionMode } from "@codem/protocol"
```

Run `pnpm --filter @codem/protocol test` and `pnpm --filter @codem/protocol typecheck` from the workspace root. See [provenance](../../UPSTREAM.md).
