import { realpath } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { runLiveInteractions } from "../tests/liveInteractions.ts"
import { runLiveImages } from "../tests/liveImages.ts"
import { liveRuntime } from "../tests/liveRuntime.ts"

const argument = process.argv.indexOf("--workspace")
if (argument < 0 || !process.argv[argument + 1]) throw new Error("Pass --workspace <existing disposable workspace>; this command never opens VS Code")
const workspace = await realpath(resolve(process.argv[argument + 1]!))
const temporary = await realpath(tmpdir())
const local = relative(temporary, workspace)
if (!local || local.startsWith(`..${sep}`) || local === ".." || isAbsolute(local)) throw new Error("Acceptance requires an existing workspace under the system temporary directory")
const extensionRoot = fileURLToPath(new URL("..", import.meta.url))
if (process.argv.includes("--images")) await runLiveImages(extensionRoot, workspace)
else await runLiveInteractions({ connect: signal => liveRuntime(extensionRoot, workspace, signal), assertTrusted() {} })
