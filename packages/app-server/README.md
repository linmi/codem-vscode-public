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

Thread permission modes use `readModes` / `setModes` and the strict `AppServerModeState` DTO. Pass the revision the user actually saw as `expectedRevision`; a conflict must remain visible, not become an unconditional write. `thread-modes-updated` events carry validated Core state, including permission epoch. Old responses from a retired thread are rejected; stale revisions cannot overwrite a newer snapshot. The browser-safe `@codem/app-server/modes` export exposes these types without pulling in process/runtime code.

The pinned Core unsubscribe acknowledgement contains a `status` of `unsubscribed` or `notSubscribed`. An empty acknowledgement is invalid for this runtime.

Space integration uses the pinned CLI's private credential-broker tools `project_list`, `space_prepare`, and `space_commit` over its temporary `__host-serve` channel. This is a broker control channel, not an additional agent transport. Only `{projectKey, displayName}` leaves the host as space metadata; managed-directory paths remain host-only. No credential files are read or written by this package.

Provide `AppServerHost.prepareSpace` to bind each Core process to broker-validated launch material: `--project-key` and `CODEM_MANAGED_DIR`. A null managed directory explicitly disables the managed layer. Ambient managed-directory, space-list and broker-command variables cannot override the selected space. Hosts without a space preparer have no managed layer. The VS Code service always provides a preparer and requires an explicit broker current space; it does not choose an arbitrary first space.

The VS Code `codem.selectSpace` command and native status bar prepare a candidate, validate Core/model/skill responses, then commit the CLI-owned account selection and retire the old idle host. Tasks and in-flight requests exclude switching; switching excludes new work. Failure before commit preserves the old host, and logout/account replacement cancels pending preparation. An unconfirmed commit reports that the shared account pointer may have changed; it does not claim rollback. The selection also affects the CLI's default for future launches. Core 0.8.37 exposes no per-thread space-switch/read contract: this development cycle deliberately does not migrate historical space ownership; new and reopened tasks use the currently selected space. Core JSONL remains the only history authority.
