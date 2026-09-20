import assert from "node:assert/strict"
import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { it, type TestContext } from "node:test"
import type { accountOperations as Operations } from "../src/connection/runtimeAccount.ts"

async function setup(t: TestContext): Promise<{ accountOperations: typeof Operations; control: { loggedIn: boolean; browser: boolean; url: string; calls: string[]; cwd: string; finish: () => void } }> {
  const root = fileURLToPath(new URL("..", import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), "codem-account-")); t.after(() => rm(directory, { recursive: true, force: true }))
  const outfile = join(directory, "fixture.mjs")
  await build({ outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent", stdin: { contents: 'export { accountOperations } from "./src/connection/runtimeAccount.ts"; export { control } from "accountFixture"', resolveDir: root }, plugins: [{ name: "account", setup(b) {
    b.onResolve({ filter: /^(vscode|@codem\/app-server|accountFixture)$/ }, args => ({ path: args.path, namespace: "account" }))
    b.onLoad({ filter: /.*/, namespace: "account" }, args => ({ contents: args.path === "accountFixture" ? `
      export const control={loggedIn:false,browser:true,url:'https://login.invalid/authorize',calls:[],cwd:'',finish:()=>{}};
    ` : args.path === "vscode" ? `
      import {control} from 'accountFixture';
      export const Uri={parse:value=>({scheme:new URL(value).protocol.slice(0,-1)})};
      export const env={openExternal:async()=>{control.calls.push('browser');return control.browser}};
    ` : `
      import {control} from 'accountFixture';
      const status=()=>({loggedIn:control.loggedIn,routerCredential:control.loggedIn,displayName:null,userId:'u',tenantId:'t',authMethod:'browser',serverUrl:null});
      export const resolveBundledAppServerRuntime=()=>({});
      export const readAppServerAuthStatus=async options=>{control.calls.push('status');control.cwd=options.workingDirectory;options.signal.throwIfAborted();return status()};
      export function startAppServerLogin(options){
        control.calls.push('login');control.cwd=options.workingDirectory;
        let resolve,reject;const result=new Promise((a,b)=>{resolve=a;reject=b});
        const completed=Promise.resolve().then(()=>options.presentAuthorization(control.url)).then(()=>result);
        control.finish=()=>{options.onProgress('binding');control.loggedIn=true;resolve(status())};
        return {completed,cancel:async()=>{control.calls.push('cancel');reject(new Error('cancelled'))}};
      }
    ` }))
  } }] })
  return import(pathToFileURL(outfile).href)
}

it("login reads auth and opens browser without workspace APIs or Core; authenticated accounts skip browser", async t => {
  const f = await setup(t); const operations = f.accountOperations("/extension"); const stages: string[] = []
  const login = operations.login(new AbortController().signal, stage => stages.push(stage))
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(f.control.calls, ["status", "login", "browser"])
  assert.equal(f.control.cwd, homedir()); f.control.finish(); assert.equal((await login).loggedIn, true)
  assert.deepEqual(stages, ["waiting", "binding"])
  f.control.calls.length = 0
  await operations.login(new AbortController().signal, () => assert.fail("unexpected progress"))
  assert.deepEqual(f.control.calls, ["status"])
})

it("browser failure and unsafe URLs reject; cancellation reaps login and a retry can succeed", async t => {
  const f = await setup(t); const operations = f.accountOperations("/extension")
  f.control.url = "http://login.invalid"; await assert.rejects(operations.login(new AbortController().signal, () => {}), /不安全/)
  assert.equal(f.control.calls.includes("browser"), false)
  f.control.url = "https://login.invalid"; f.control.browser = false
  await assert.rejects(operations.login(new AbortController().signal, () => {}), /无法打开/)
  f.control.browser = true; f.control.calls.length = 0
  const abort = new AbortController(); const login = operations.login(abort.signal, () => {})
  const rejection = assert.rejects(login, /cancelled/)
  await new Promise(resolve => setImmediate(resolve)); abort.abort(); await rejection
  assert.deepEqual(f.control.calls, ["status", "login", "browser", "cancel"])
  const retry = operations.login(new AbortController().signal, () => {})
  await new Promise(resolve => setImmediate(resolve)); f.control.finish(); await retry
})
