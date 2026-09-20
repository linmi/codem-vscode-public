import { build } from "esbuild"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { stageAppServerRuntime } from "@codem/app-server/build"

const root = fileURLToPath(new URL("..", import.meta.url))
const destination = resolve(root, "dist/nativeChat")
const require = createRequire(import.meta.url)
const source = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { version: string }
await mkdir(destination, { recursive: true })
// Separate manifest: proposed APIs never leak into the normal extension build.
const manifest = {
  name: "codem-native-experiment", displayName: "CodeM Native Experiment", publisher: "codem", version: source.version,
  description: "CodeM Core in the native VS Code Chat session picker (local experiment).", license: "MIT", private: true,
  engines: { vscode: "^1.138.0" }, main: "./extension.cjs", extensionKind: ["workspace"],
  enabledApiProposals: ["chatSessionsProvider"],
  capabilities: { untrustedWorkspaces: { supported: "limited", description: "连接和执行需要信任工作区。" }, virtualWorkspaces: false },
  contributes: {
    commands: [
      { command: "codemNative.connect", title: "连接并加载会话", category: "CodeM Native" },
      { command: "codemNative.signIn", title: "登录并连接", category: "CodeM Native" },
      { command: "codemNative.showOutput", title: "查看实验日志", category: "CodeM Native" },
    ],
    chatSessions: [{
      type: "codem-native", name: "codem", displayName: "CodeM", description: "由 CodeM Core 执行任务（本地实验）",
      icon: "$(sparkle)", canDelegate: true, requiresCopilotSignIn: false, supportsAutoModel: true,
      welcomeTitle: "CodeM Agent", welcomeMessage: "直接输入任务，由 CodeM Core 执行。使用 Core 当前模型和默认审批权限。尚未登录时运行 **CodeM Native: 登录并连接**。",
      inputPlaceholder: "交给 CodeM 的任务…", autoAttachReferences: false,
      capabilities: { supportsFileAttachments: false, supportsToolAttachments: false, supportsMCPAttachments: false, supportsImageAttachments: false, supportsSearchResultAttachments: false, supportsInstructionAttachments: false, supportsHandOffs: false },
    }],
  },
}
await writeFile(resolve(destination, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
stageAppServerRuntime({ packageRoot: resolve(dirname(require.resolve("@codem/app-server")), ".."), extensionRoot: destination })
await build({ absWorkingDir: root, entryPoints: ["src/nativeChat/nativeChatExtension.ts"], outfile: resolve(destination, "extension.cjs"), bundle: true, platform: "node", format: "cjs", external: ["vscode"], target: "node22", sourcemap: true, logLevel: "info" })
await build({ absWorkingDir: root, entryPoints: ["tests/nativeChatExtensionSmoke.ts"], outfile: resolve(destination, "extensionSmoke.cjs"), bundle: true, platform: "node", format: "cjs", external: ["vscode"], target: "node22" })
console.log(`Native CodeM experiment: ${destination}`)
