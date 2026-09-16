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
