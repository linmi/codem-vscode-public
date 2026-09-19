# Core session history

Node-only durable history boundary for editor hosts. `readSessionHistory` streams the shared Desktop JSONL reducer into a newest-first page selection, returning turns in chronological display order. The reducer is selectively imported from `main@d7763f0a`; provenance and the two local changes are recorded in `../../UPSTREAM.md`.

Hosts must enforce workspace trust and authentication before reading. Supply the same environment/root used by Core: `LINCO_SESSIONS_ROOT`, then `LINCO_HOME/sessions`, then `~/.codem/sessions`. The webview supplies only a thread ID and opaque cursor, never a filesystem path. Header identity, cwd, schema 13, sequencing and symlink traversal are checked. Cursors bind to file identity and revision; a rewrite/clear/append requires reopening rather than combining snapshots. Mid-replay mutations fail explicitly. A trailing incomplete write is ignored until newline-committed; complete malformed records fail.

The wrapper retains the requested turn window, hydrates tool results from integrity-checked durable blobs, and never writes Core history. It performs a full streaming replay per request; there is no persistent index or SQLite runtime requirement. The shared reducer's submission identity set and active turn/background aggregates still scale with the size of that turn and task set. Raw records, paths and process objects are not webview DTOs.

Run `pnpm --filter @codem/session-history test` and `pnpm --filter @codem/session-history typecheck` from the workspace root. Tests use temporary JSONL fixtures; application integration tests will belong to future applications.
