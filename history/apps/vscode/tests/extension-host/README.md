# Extension Host acceptance

These tests activate the development extension in a real VS Code Extension Host. They require a disposable trusted workspace and, except for checked-in JSONL fixtures in `tests/host`, a signed-in CodeM credential broker. They never start `kilo serve`.

Automated host-level coverage for the same cycle (success, HITL reject, duplicate/stale events, cancel, crash/reload, JSONL schema 13 reconstruction) lives in `tests/host/services/app-server/acceptance-cycle.test.ts` and does not need login or a GUI.

Repeatable live launch from `apps/vscode`:

```sh
pnpm --dir apps/vscode run test:extension-host
pnpm --dir apps/vscode run test:extension-host:live-send
```

The runner uses the macOS `Visual Studio Code.app` executable, an isolated `--user-data-dir`, and `--disable-workspace-trust`. It does **not** isolate `~/.codem`, so the broker can reuse an existing login. Success requires the PASS marker (and `EXTENSION_HOST_RESULT.txt` for `hitl-reload.ts`). Rebuild `dist/extension.js` before live runs: a stale production bundle can still spawn `kilo serve` even though current `ServerManager.getServer()` fail-closes. The runner fails if it sees `kilo server listening`.

# Thread permission mode acceptance

This test activates the development extension in a real VS Code Extension Host, checks the new command and removal of the global toggle, then exercises two controllers sharing the VS Code service and bundled Core. It verifies an explicit initial approval preset, preservation of that mode while changing thinking effort, mode broadcasts, stale-revision rejection and unsubscribe/resume without sending an agent turn. The credential broker must already be signed in; the test does not initiate login or read credential files.

Build from the repository root:

```sh
pnpm --dir apps/vscode run bundle:production
pnpm --dir apps/vscode exec esbuild tests/extension-host/permission-mode.ts --bundle --platform=node --format=cjs --external:vscode --outfile=dist/tests/permission-mode.cjs
```

Launch the VS Code executable with `--extensionDevelopmentPath` pointing to `apps/vscode`, `--extensionTestsPath` pointing to the generated `dist/tests/permission-mode.cjs`, and a disposable trusted workspace. Use isolated `--user-data-dir` and `--extensions-dir` directories and `--disable-extensions`. Core reports canonical working directories; the test resolves the disposable workspace before invoking the service.

Success requires exit code zero **and** the `PERMISSION_MODE_EXTENSION_HOST_PASS` output marker. The macOS `code` launcher can return before tests finish; use the application executable at `Visual Studio Code.app/Contents/MacOS/Code`, or inspect the test window's renderer log. The test deletes its own Core thread in `finally`; it does not modify existing conversations. This is service/controller integration coverage, not a visual Webview or live tool-approval test.

# Space selector acceptance

`spaces.ts` checks the public `codem.selectSpace` command, broker DTOs, launch in the current space, failed preparation preserving the previous thread, concurrent request exclusion, idle-host retirement, model/skill refresh, and reopening a thread. It re-selects the account's existing space, so it commits the same account pointer; it never chooses another space, reads credential files, or executes an agent turn. Run `pnpm --dir apps/vscode exec bun test tests/unit/spaces-service.test.ts` separately for controlled failure, active-work, logout and account-replacement tests.

```sh
pnpm --dir apps/vscode run bundle:production
pnpm --dir apps/vscode exec esbuild tests/extension-host/spaces.ts --bundle --platform=node --format=cjs --external:vscode --outfile=dist/tests/spaces.cjs
```

Use the launch setup above with `dist/tests/spaces.cjs`. Success requires exit zero and `SPACES_EXTENSION_HOST_PASS`. A caught failure writes `spaces-failure.txt` into the disposable workspace. On macOS, keep the isolated user-data path short (for example `/tmp/cs-.../u`); a long path exceeds the Unix socket limit before tests start. This is native command/service/controller acceptance; it does not drive QuickPick or inspect the visual status bar.

# Live first-message acceptance

`live-send.ts` sends one real model turn through the service/controller with Medium thinking and Auto permissions. It concurrently reads the new thread's modes and history, requires both answer lines separated by a blank line and a successful `turn/completed`, and verifies the connection and permissions remain available. This checks that multiline streaming does not truncate the answer or retire the connection. Deterministic Host tests additionally cover standalone spaces, tabs, line breaks, and empty chunks across assistant, reasoning, and side-question streams. The live test also exercises configured lifecycle hooks, including the Core 0.8.37 `SessionStart` regression (`tool: ""`, `reason: null`, `outcome: "allow"`).

```sh
pnpm --dir apps/vscode exec esbuild tests/extension-host/live-send.ts --bundle --platform=node --format=cjs --external:vscode --outfile=dist/tests/live-send.cjs
```

Use the isolated, disposable trusted workspace setup above with `dist/tests/live-send.cjs`. The credential broker must already be signed in. This test uses model quota and runs the account's configured hooks; it requests no file inspection or workspace tools. It deletes only its own test thread on completion. Success requires exit zero and `LIVE_SEND_EXTENSION_HOST_PASS`; closing the test window before that marker is not a passing result. This verifies real Extension Host integration, not visual Webview rendering.

# Live HITL and JSONL reload acceptance

`hitl-reload.ts` is the live cycle: signed-in broker, one `sendMessage` turn with `permissionMode: "default"`, one HITL (`permissionResponse` or `questionReply`), then a fresh service/controller `loadMessages` that must match `@codem/session-history` schema 13. It writes `EXTENSION_HOST_RESULT.txt` in the disposable workspace. It deletes only its own test thread. Pinned Core 0.8.37 may send empty approval `label`s; Host falls back to `name` / `kind` / `optionId` so the request is not rejected as `-32602`.

```sh
pnpm --dir apps/vscode run test:extension-host
```

# JSONL history recovery acceptance

`history.ts` reads a deliberately selected real three-turn regression conversation twice through fresh VS Code services. Set `CODEM_HISTORY_TEST_CWD` and `CODEM_HISTORY_TEST_THREAD` to the fixture session used for the report (first reply is `FIRST LINE`, blank line, `LAST LINE`). It verifies six ordered messages and complete final-answer tool inputs/results. It reads only; it does not send a model request, rewrite or delete the conversation, or require a local Core build.

Build with `pnpm --dir apps/vscode exec esbuild tests/extension-host/history.ts --bundle --platform=node --format=cjs --external:vscode --outfile=dist/tests/history.cjs`, then use the isolated trusted test workspace launch above. Success requires exit zero and `HISTORY_EXTENSION_HOST_PASS`. This checks Node/Extension Host service integration; the renderer regression separately checks actual message components.
