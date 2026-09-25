# @codem/app-server

Interactive capability and usage documentation: run `pnpm --filter @codem/docs dev` from the workspace root, then open [the local docs](http://127.0.0.1:4174). Source and build instructions: [apps/docs](../../apps/docs/README.md).

Reusable Node-only CodeM App Server client/runtime boundary. Core itself is supplied by the pinned published package; this package is not the Core server implementation.

The active VS Code application consumes this package. Its initial source and tests were copied from the archived implementation; see [provenance](../../UPSTREAM.md).

It owns the exact published Core and authentication CLI versions, supported platform mapping, executable and license resolution, deterministic extension staging, installed-bundle integrity checks, and the shared Host protocol/lifecycle implementation. The CLI binary is used only as the published credential broker; App Server still starts the smaller Core executable directly. The package never reads or writes credential files and does not own editor APIs or Webview state.

Authentication is checked before an editor starts a thread. The published browser authorization page handles both existing-user sign-in and new-user registration; there is no separate local registration command.

Assistant, reasoning, and side-question text deltas preserve spaces, tabs, and line breaks exactly. Empty string chunks are valid no-ops and are not forwarded to consumers. Missing or non-string text fields and conflicting `delta` / `deltaText` values remain protocol errors; whitespace in text must never be validated as an identifier.

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

`AppServerHost` pools one long-lived Core child process per canonical absolute `cwd`. Permission mode is per-thread (`thread/mode/read|set`), not a second connection key. The connection drains stderr through the editor-owned logging hook, performs and validates `initialize`, sends `initialized`, correlates concurrent requests, routes notifications and server requests, and fails closed on malformed, duplicate, stale, or unknown frames. Shutdown is bounded: stdin close is followed by `SIGTERM` and then `SIGKILL` when Core does not exit. The pinned Core 0.8.44 currently omits `jsonrpc` on responses, so inbound frames temporarily accept either omission or the exact value `"2.0"`; outbound frames are always JSON-RPC 2.0.

For `hook/completed`, Core 0.8.37 emits an empty `run.tool` for lifecycle hooks such as `SessionStart`, and `run.reason` may be `null`. The host represents both absent associations and absent reasons explicitly as `null`; missing or incorrectly typed wire fields still fail validation. A successful hook verdict is `allow`. Hook failure verdicts remain distinct from the turn's terminal result.

Build scripts import staging from `@codem/app-server/build`:

```ts
import { stageAppServerRuntime } from "@codem/app-server/build"

stageAppServerRuntime({ packageRoot, extensionRoot })
```

Each target-specific extension contains its matching Core executable, authentication broker executable, both published licenses, and `bin/app-server/runtime.json`. Consumers fail closed when either platform, version, executable metadata, or SHA-256 differs.

Thread permission modes use `readModes` / `setModes` and the strict `AppServerModeState` DTO, which is a re-export of `@codem/protocol`. Pass the revision the user actually saw as `expectedRevision`; a conflict must remain visible, not become an unconditional write. `thread-modes-updated` events carry validated Core state, including permission epoch. Old responses from a retired thread are rejected; stale revisions cannot overwrite a newer snapshot. `@codem/app-server/modes` keeps raw-frame parsers; hosts and webviews import the shared DTO from `@codem/protocol`.

The pinned Core unsubscribe acknowledgement contains a `status` of `unsubscribed` or `notSubscribed`. An empty acknowledgement is invalid for this runtime.

Space integration uses the pinned CLI's private credential-broker tools `project_list`, `space_prepare`, and `space_commit` over its temporary `__host-serve` channel. This is a broker control channel, not an additional agent transport. Only `{projectKey, displayName}` leaves the host as space metadata; managed-directory paths remain host-only. No credential files are read or written by this package.

For initial connections, `prepareInitialAppServerSpace(options, requestedKey?)` lists and prepares an available remembered/current space on one temporary broker, returning `prepared` launch material or `selection-required` with its catalog. The broker is closed before either result returns, including before any user prompt. Applications must renew authentication after user selection and call standalone preparation for that new transaction. Startup launch material is consumed only once; directory refresh and later connections retain fresh validation. See [startup measurements and lifecycle checks](../../docs/connectionGovernance.md).

Provide `AppServerHost.prepareSpace` to bind each Core process to broker-validated launch material: `--project-key` and `CODEM_MANAGED_DIR`. A null managed directory explicitly disables the managed layer. Ambient managed-directory, space-list and broker-command variables cannot override the selected space. Hosts without a space preparer have no managed layer. Each application must supply its own selection UI and explicitly bind its selected space.

### Historical turn recovery

Realtime turns continue to use pinned online CLI 0.1.208 / Core 0.8.47. Durable history is read by the editor host through `@codem/history` from Core JSONL schema 13. This reuses the shared Desktop record reducer and domain types from `main@d7763f0a`, including user invocation boundaries, hidden model inputs, tool correlation, clear and rewind semantics. `listLiveThreadTurns` and `listLiveThreadItems` expose typed, ephemeral diagnostic snapshots; they are never history sources. Each request uses `limit: 50`; `nextCursor` is a numeric offset (or `null`) and is passed unchanged to the next request. String cursors are rejected against the pinned Core 0.8.44 contract. Snapshot-only `steerAccepted` records are modeled separately from streamed items. No local Core override is required.

History failures are explicit; there is no RPC fallback or second transcript store. Live `turn/completed` remains terminal authority. In-flight JSONL snapshots cannot replace live parts; idle reopening replaces the viewport from the durable projection.

Run `pnpm --filter @codem/app-server test` and `pnpm --filter @codem/app-server typecheck` from the workspace root. Tests use fixtures and fake processes; they do not sign in or execute live agent turns.

Background wake events remain observable while the originating turn is idle. A `turn/started` notification on a subscribed thread can begin a Core-owned background turn with `submissionId: null`; its streamed items, approvals and terminal event follow the normal lifecycle. Completed turn IDs are remembered for that subscription so a duplicate start cannot revive a finished turn. Notifications for unsubscribed threads remain ignored.

Pinned Core 0.8.44 reports each `thread/backgroundTerminals/list` row with `alive`, `processId`, `logPath` and process metadata. The host maps `alive` to its normalized `inProgress` boolean and excludes metadata from that DTO. The old assumed wire field `inProgress` is rejected, not used as a fallback. This mapping and process termination/cleanup are covered by the VS Code opt-in resource integration test.

### Shutdown ownership and fault verification

For an established connection, `AppServerHost.close()` shares one promise across callers. Each Core process gets a single 1-second grace period for interrupt, side-question cancellation and unsubscribe together. A missing acknowledgement cannot delay stdin closure indefinitely. The existing transport then waits up to 2 seconds per stage (EOF, SIGTERM, SIGKILL); connections retire independently. Closing the peer rejects outstanding RPCs, and no further graceful RPC is sent after transport shutdown starts. All processes are awaited before cleanup errors are aggregated. Connection preparation still uses its own authentication/initialization lifecycle; this budget begins once the connection is established.

The VS Code controller synchronously revokes old event authority before retiring a session. Switching spaces can publish the prepared replacement while the previous process exits. Every retirement, including protocol/authentication failures, is tracked until settled. Repeated disposal observes the same promise and waits for current and already-retiring hosts; cleanup failure remains a rejection. Connecting operations are cancelled through the lifetime signal, and late results are closed without binding them.

The default tests include real child-process fixtures that withhold unsubscribe, interrupt or side-question cancellation replies, plus a child ignoring EOF and SIGTERM. Assertions check that the PID no longer exists and that the independent test watchdog was not needed. These are isolated protocol fixtures, not live Core or model calls. Controller tests cover repeated disposal, failure-triggered retirement, slow space retirement and failure while other hosts are still closing.

### Child process termination

`src/processLifecycle.ts` decides how each asynchronous child process this package starts is stopped. Each caller uses one named policy, and the timeouts are named constants there. `preflightAppServer` runs Core through `spawnSync` and relies on its built-in timeout.

| Process | Policy | Tree | Sequence |
| --- | --- | --- | --- |
| Core App Server | graceful | no | stdin EOF, `SIGTERM`, `SIGKILL`, waiting up to `closeTimeoutMs` (2 s) after each; an error if Core outlives all three |
| `auth login` | graceful | no | `SIGTERM`, `SIGKILL`, waiting up to `closeTimeoutMs` (2 s) after each; an error if it outlives both |
| `auth status`, `auth logout` | immediate | no | `SIGKILL` on the 30 s deadline, cancellation or oversized output; the call returns once the process has closed |
| Space broker (`__host-serve`) | immediate | no | `SIGKILL` after every run and on the 180 s deadline, cancellation or protocol failure; the call returns once the broker has closed |
| `plugin` commands | graceful | yes | on the 60 s deadline, cancellation or oversized output: `SIGTERM` to the process group (`taskkill /pid <pid> /t /f` on Windows), `SIGKILL` 1 s later; the command settles once it has closed |

A tree policy only reaches the whole tree when the child is spawned with `terminationSpawnOptions(policy)`, which makes it lead its own POSIX process group. Timeouts must be positive and finite (`requirePositiveTimeout`); otherwise `setTimeout` would expire almost immediately. `tests/processLifecycle.test.ts` checks every policy, escalation step, the POSIX and Windows tree branches, and that Core still fits the 7-second shutdown budget; it also runs in `pnpm test:windows`.

Native skills use `startTurn({ skillName, text, ... })` with Core structured skill input; attachments are rejected for this input variant. `clearThread` validates the operation/source identity and returns the newly loaded thread ID. The editor must revoke old handles and use that new identity. See [capability acceptance and Core limitations](../../docs/appServerCapabilities.md).
