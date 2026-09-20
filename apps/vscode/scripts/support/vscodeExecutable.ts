import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import { isAbsolute, join } from "node:path"

export function vscodeExecutable(environment: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const configured = environment.CODEM_VSCODE_EXECUTABLE
  if (configured) {
    if (!isAbsolute(configured) || !isFile(configured) || (platform === "win32" && !configured.toLowerCase().endsWith(".exe"))) {
      throw new Error("CODEM_VSCODE_EXECUTABLE must be an absolute application executable path (Code.exe on Windows, not code.cmd)")
    }
    return configured
  }
  if (platform === "win32") {
    const candidates = [
      environment.LOCALAPPDATA && join(environment.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"),
      ...[environment.ProgramW6432, environment.ProgramFiles, environment["ProgramFiles(x86)"]]
        .filter((directory): directory is string => Boolean(directory))
        .map(directory => join(directory, "Microsoft VS Code", "Code.exe")),
    ]
    const executable = candidates.find((path): path is string => Boolean(path && isFile(path)))
    if (executable) return executable
  }
  if (platform === "darwin") {
    const bundle = "/Applications/Visual Studio Code.app/Contents"
    if (isFile(join(bundle, "Info.plist"))) {
      const name = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleExecutable", join(bundle, "Info.plist")], { encoding: "utf8" }).trim()
      const executable = join(bundle, "MacOS", name)
      if (isFile(executable)) return executable
    }
  }
  throw new Error("Set CODEM_VSCODE_EXECUTABLE to the VS Code application executable (Code.exe on Windows)")
}

function isFile(path: string): boolean {
  try { return statSync(path).isFile() } catch { return false }
}
