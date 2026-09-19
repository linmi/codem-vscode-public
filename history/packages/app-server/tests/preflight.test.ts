import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, it } from "node:test"
import {
  APP_SERVER_CLI_VERSION,
  APP_SERVER_CORE_VERSION,
  REQUIRED_APP_SERVER_BOOLEAN_CAPABILITIES,
  REQUIRED_APP_SERVER_ITEM_STATUSES,
  REQUIRED_APP_SERVER_ITEM_TYPES,
  preflightAppServer,
} from "../src/index.ts"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("App Server preflight", () => {
  it("accepts protocol 1 with the complete required capability surface", () => {
    const fixture = createRuntimeFixture()
    const result = preflightAppServer({
      packageRoot: fixture.root,
      workingDirectory: fixture.root,
      platform: "darwin",
      arch: "arm64",
      environment: fixtureEnvironment(),
    })
    assert.equal(result.target, "darwin-arm64")
    assert.equal(result.coreVersion, APP_SERVER_CORE_VERSION)
    assert.equal(result.protocolVersion, 1)
    assert.equal(result.agentVersion, `${APP_SERVER_CORE_VERSION}+1.g0123456`)
    assert.equal(result.responseJsonrpc, "2.0")
    assert.match(result.sha256, /^[a-f0-9]{64}$/u)
  })

  it("rejects non-JSON-RPC output", () => {
    const fixture = createRuntimeFixture({ response: "not json" })
    assert.throws(
      () =>
        preflightAppServer({
          packageRoot: fixture.root,
          workingDirectory: fixture.root,
          platform: "darwin",
          arch: "arm64",
          environment: fixtureEnvironment(),
        }),
      /returned invalid JSON/u,
    )
  })

  it("records the published Core response shape when the JSON-RPC version is omitted", () => {
    const response = JSON.parse(successfulResponse(completeCapabilities())) as Record<string, unknown>
    delete response.jsonrpc
    const fixture = createRuntimeFixture({ response: JSON.stringify(response) })
    const result = preflightAppServer({
      packageRoot: fixture.root,
      workingDirectory: fixture.root,
      platform: "darwin",
      arch: "arm64",
      environment: fixtureEnvironment(),
    })
    assert.equal(result.responseJsonrpc, "omitted")
  })

  it("rejects an explicit non-2.0 JSON-RPC version", () => {
    const response = JSON.parse(successfulResponse(completeCapabilities())) as Record<string, unknown>
    response.jsonrpc = "1.0"
    const fixture = createRuntimeFixture({ response: JSON.stringify(response) })
    assert.throws(
      () =>
        preflightAppServer({
          packageRoot: fixture.root,
          workingDirectory: fixture.root,
          platform: "darwin",
          arch: "arm64",
          environment: fixtureEnvironment(),
        }),
      /jsonrpc must be "2\.0"; received "1\.0"/u,
    )
  })

  it("rejects a missing required capability", () => {
    const capabilities = completeCapabilities()
    ;(capabilities.threads as Record<string, unknown>).modelSelection = false
    const fixture = createRuntimeFixture({ response: successfulResponse(capabilities) })
    assert.throws(
      () =>
        preflightAppServer({
          packageRoot: fixture.root,
          workingDirectory: fixture.root,
          platform: "darwin",
          arch: "arm64",
          environment: fixtureEnvironment(),
        }),
      /missing required capability threads\.modelSelection=true/u,
    )
  })

  it("rejects an unsupported protocol version", () => {
    const fixture = createRuntimeFixture({ response: successfulResponse(completeCapabilities(), 2) })
    assert.throws(
      () =>
        preflightAppServer({
          packageRoot: fixture.root,
          workingDirectory: fixture.root,
          platform: "darwin",
          arch: "arm64",
          environment: fixtureEnvironment(),
        }),
      /protocol 2 is not supported; expected 1/u,
    )
  })
})

function createRuntimeFixture(options: { readonly response?: string } = {}): { readonly root: string } {
  const root = createTemporaryDirectory("codem-app-server-")
  writeJson(join(root, "package.json"), { private: true })

  const scope = join(root, "node_modules", "@lark-codem")
  const core = join(scope, "codem-core")
  const platform = join(scope, "codem-core-darwin-arm64")
  const cli = join(scope, "codem-cli")
  const authPlatform = join(scope, "codem-cli-darwin-arm64")
  mkdirSync(core, { recursive: true })
  mkdirSync(platform, { recursive: true })
  mkdirSync(cli, { recursive: true })
  mkdirSync(authPlatform, { recursive: true })
  writeJson(join(core, "package.json"), {
    name: "@lark-codem/codem-core",
    version: APP_SERVER_CORE_VERSION,
  })
  writeJson(join(platform, "package.json"), {
    name: "@lark-codem/codem-core-darwin-arm64",
    version: APP_SERVER_CORE_VERSION,
  })
  writeJson(join(cli, "package.json"), {
    name: "@lark-codem/codem-cli",
    version: APP_SERVER_CLI_VERSION,
  })
  writeJson(join(authPlatform, "package.json"), {
    name: "@lark-codem/codem-cli-darwin-arm64",
    version: APP_SERVER_CLI_VERSION,
  })

  const executablePath = join(platform, "codem-core")
  mkdirSync(dirname(executablePath), { recursive: true })
  const response = options.response ?? successfulResponse(completeCapabilities())
  writeFileSync(
    executablePath,
    `#!/usr/bin/env node\nprocess.stdin.resume()\nprocess.stdin.on("end", () => process.stdout.write(${JSON.stringify(`${response}\n`)}))\n`,
  )
  chmodSync(executablePath, 0o755)
  writeFileSync(join(platform, "LICENSE"), "fixture license\n")
  const authExecutablePath = join(authPlatform, "bin", "codem")
  mkdirSync(dirname(authExecutablePath), { recursive: true })
  writeFileSync(authExecutablePath, "#!/bin/sh\nexit 0\n")
  chmodSync(authExecutablePath, 0o755)
  writeFileSync(join(authPlatform, "LICENSE"), "fixture auth license\n")
  return { root }
}

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function successfulResponse(capabilities: Record<string, unknown>, protocolVersion = 1): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: "codem-vscode-preflight",
    result: {
      protocolVersion,
      agentInfo: { version: `${APP_SERVER_CORE_VERSION}+1.g0123456` },
      capabilities,
    },
  })
}

function completeCapabilities(): Record<string, unknown> {
  const capabilities: Record<string, unknown> = {}
  for (const path of REQUIRED_APP_SERVER_BOOLEAN_CAPABILITIES) {
    assignNested(capabilities, path, true)
  }
  assignNested(capabilities, "items.types", [...REQUIRED_APP_SERVER_ITEM_TYPES])
  assignNested(capabilities, "items.statuses", [...REQUIRED_APP_SERVER_ITEM_STATUSES])
  return capabilities
}

function assignNested(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".")
  let current = target
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment]
    if (typeof next === "object" && next !== null && !Array.isArray(next)) {
      current = next as Record<string, unknown>
    } else {
      const created: Record<string, unknown> = {}
      current[segment] = created
      current = created
    }
  }
  current[segments.at(-1)!] = value
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function fixtureEnvironment(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH }
}
