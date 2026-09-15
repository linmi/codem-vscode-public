# @codem/ui

CodeM's shared React design-system source. Components are owned in this repository and managed with the shadcn CLI; this is not a wrapper around the legacy Solid component packages.

Add a component from the repository root:

```bash
pnpm ui:add -- button
```

Import components through explicit package exports:

```tsx
import { Button } from "@codem/ui/components/button"
```

The current VS Code webview still uses the imported Solid UI under `packages/legacy/`. New product UI must target this package, and the app should switch atomically when its React webview migration Cycle is implemented.
