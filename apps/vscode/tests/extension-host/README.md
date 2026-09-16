# Thread permission mode acceptance

This test activates the development extension in a real VS Code Extension Host, checks the new command and removal of the global toggle, then exercises two controllers sharing the VS Code service and bundled Core. It verifies mode broadcasts, stale-revision rejection and unsubscribe/resume without sending an agent turn. The credential broker must already be signed in; the test does not initiate login or read credential files.

Build from the repository root:

```sh
pnpm --dir apps/vscode run bundle:production
pnpm --dir apps/vscode exec esbuild tests/extension-host/permission-mode.ts --bundle --platform=node --format=cjs --external:vscode --outfile=dist/tests/permission-mode.cjs
```

Launch the VS Code executable with `--extensionDevelopmentPath` pointing to `apps/vscode`, `--extensionTestsPath` pointing to the generated `dist/tests/permission-mode.cjs`, and a disposable trusted workspace. Use isolated `--user-data-dir` and `--extensions-dir` directories and `--disable-extensions`. Core reports canonical working directories; the test resolves the disposable workspace before invoking the service.

Success requires exit code zero **and** the `PERMISSION_MODE_EXTENSION_HOST_PASS` output marker. The macOS `code` launcher can return before tests finish; use the application executable at `Visual Studio Code.app/Contents/MacOS/Code`, or inspect the test window's renderer log. The test deletes its own Core thread in `finally`; it does not modify existing conversations. This is service/controller integration coverage, not a visual Webview or live tool-approval test.
