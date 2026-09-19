#!/usr/bin/env node
import { spawn } from "node:child_process"
import { extensionRoot, windows } from "./node-run.ts"

const root = extensionRoot()
const children = ["watch:esbuild", "watch:tsc"].map((script) =>
  spawn("pnpm", ["run", script], { cwd: root, stdio: "inherit", shell: windows }),
)

function shutdown(code: number) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM")
  }
  process.exit(code)
}

for (const child of children) {
  child.on("exit", (code) => shutdown(code ?? 1))
}
