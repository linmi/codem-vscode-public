# @codem/protocol

Physical path: `packages/protocol`. Isomorphic CodeM catalog and thread-mode DTOs shared by editor hosts and webviews. This is not leftover `@opencode-ai/protocol`; leftover OpenCode HttpApi schema lives inside leftover `@opencode-ai/server`.

Types are handwritten and aligned with this repository's `@codem/app-server` catalog/mode shapes (`codemModelsLoaded`, `codemSkillsLoaded`, `threadModes*`). The package has no runtime dependencies and must not import leftover SDK packages, Node, VS Code, Electron, or DOM APIs. It is not a UI package and not an `@codem/app-server/dto` subpath. Hosts keep whitelist copy functions; App Server keeps raw-frame parsers and re-exports these types when the Host API shape is identical.

```ts
import type { CodemModelCatalog, CodemModeState, CodemSkillSummary } from "@codem/protocol"
import { CODEM_BUILTIN_INTELLIGENCE_TIERS, parseCodemPermissionMode } from "@codem/protocol"
```

Run `pnpm test:protocol` and `pnpm typecheck:protocol` from the workspace root. JetBrains does not import this package yet.
