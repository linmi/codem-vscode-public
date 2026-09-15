# @codem/app-server

Reusable CodeM App Server runtime package for editor clients in this monorepo.

It owns the exact published Core and authentication CLI versions, supported platform mapping, executable and license resolution, deterministic extension staging, installed-bundle integrity checks, and the shared Host protocol/lifecycle implementation. The CLI binary is used only as the published credential broker; App Server still starts the smaller Core executable directly. The package never reads or writes credential files and does not own editor APIs or Webview state.

Authentication is checked before an editor starts a thread. The published browser authorization page handles both existing-user sign-in and new-user registration; there is no separate local registration command.

```ts
import { assertAppServerAuthenticated, readAppServerAuthStatus, startAppServerLogin } from "@codem/app-server"

const status = await readAppServerAuthStatus({ runtime, workingDirectory })
if (!status.loggedIn) {
  const login = startAppServerLogin({
    runtime,
    workingDirectory,
    presentAuthorization: openInSystemBrowser,
  })
  assertAppServerAuthenticated(await login.completed)
}
```

Installed editor clients resolve the staged runtime, then give the package their platform-owned hooks:

```ts
import { resolveBundledAppServerRuntime, startAppServerConnection } from "@codem/app-server"

const runtime = resolveBundledAppServerRuntime({ extensionRoot })
const connection = await startAppServerConnection({
  runtime,
  workingDirectory: workspacePath,
  clientInfo: { name: "codem-vscode", version: extensionVersion },
  onNotification: routeNotification,
  onRequest: routeClientRequest,
  onProtocolError: reportProtocolFailure,
  onStderr: appendToOutputChannel,
  onExit: handleCoreExit,
})

const result = await connection.request("thread/list", { cwd: workspacePath })
await connection.close()
```

The connection owns one long-lived Core child process, drains stderr through the editor-owned logging hook, performs and validates `initialize`, sends `initialized`, correlates concurrent requests, routes notifications and server requests, and fails closed on malformed, duplicate, stale, or unknown frames. Shutdown is bounded: stdin close is followed by `SIGTERM` and then `SIGKILL` when Core does not exit. The pinned Core 0.8.37 currently omits `jsonrpc` on responses, so inbound frames temporarily accept either omission or the exact value `"2.0"`; outbound frames are always JSON-RPC 2.0.

Build scripts import staging from `@codem/app-server/build`:

```ts
import { stageAppServerRuntime } from "@codem/app-server/build"

stageAppServerRuntime({ packageRoot, extensionRoot })
```

Each target-specific extension contains its matching Core executable, authentication broker executable, both published licenses, and `bin/app-server/runtime.json`. Consumers fail closed when either platform, version, executable metadata, or SHA-256 differs.
