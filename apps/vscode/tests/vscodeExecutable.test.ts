import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { it } from "node:test"
import { vscodeExecutable } from "../scripts/support/vscodeExecutable.ts"

it("finds Windows user and system installations and honors an explicit portable executable", async t => {
  const root = await mkdtemp(join(tmpdir(), "codem VS Code 中文 "))
  t.after(() => rm(root, { recursive: true, force: true }))
  const user = join(root, "Local", "Programs", "Microsoft VS Code", "Code.exe")
  const system = join(root, "Program Files", "Microsoft VS Code", "Code.exe")
  const portable = join(root, "portable", "Code.exe")
  for (const file of [user, system, portable]) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, "fixture") }
  const environment = { LOCALAPPDATA: join(root, "Local"), ProgramFiles: join(root, "Program Files") }
  assert.equal(vscodeExecutable(environment, "win32"), user)
  assert.equal(vscodeExecutable({ ...environment, CODEM_VSCODE_EXECUTABLE: portable }, "win32"), portable)
  await rm(user)
  assert.equal(vscodeExecutable(environment, "win32"), system)
  assert.equal(vscodeExecutable({ ProgramW6432: environment.ProgramFiles }, "win32"), system)
  assert.equal(vscodeExecutable({ "ProgramFiles(x86)": environment.ProgramFiles }, "win32"), system)
  assert.throws(() => vscodeExecutable({ ...environment, CODEM_VSCODE_EXECUTABLE: user }, "win32"), /absolute application executable/)
  const command = join(root, "code.cmd")
  await writeFile(command, "fixture")
  for (const value of ["Code.exe", command, root]) assert.throws(() => vscodeExecutable({ CODEM_VSCODE_EXECUTABLE: value }, "win32"), /absolute application executable/)
  assert.throws(() => vscodeExecutable({}, "win32"), /Set CODEM_VSCODE_EXECUTABLE/)
})
