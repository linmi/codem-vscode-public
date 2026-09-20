import assert from "node:assert/strict"
import { it } from "node:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { accountProfilePath, projectAccountAvatar, readAccountAvatar } from "../src/connection/accountAvatar.ts"
import { parseAccountAvatarUrl } from "../src/shared/accountAvatar.ts"
import type { AppServerAuthStatus } from "@codem/app-server"

const status: AppServerAuthStatus = { loggedIn:true, routerCredential:true, userId:"user", tenantId:"tenant", serverUrl:"https://codem.feishu.cn", displayName:"Name", authMethod:"feishu_oauth" }
const url = "https://s1-imfile.feishucdn.com/avatar.jpg"
const config = () => ({ serverUrl:status.serverUrl, auth:{oauth:{userId:"user",tenantId:"tenant",userAccessToken:"secret-token",refreshToken:"secret-refresh",userInfo:{avatar_url:url,name:"Name",email:"private@example.com"}}} })

it("reads only the current authenticated account's avatar and never projects credentials or other profile fields", () => {
  assert.deepEqual(projectAccountAvatar(config(), status), {kind:"image",url})
  for (const changed of [{userId:"other"},{tenantId:"other"},{serverUrl:"https://another.invalid"},{userId:null},{tenantId:null}]) assert.deepEqual(projectAccountAvatar(config(), {...status,...changed}), {kind:"unavailable"})
  for (const changed of [{loggedIn:false},{routerCredential:false}]) assert.deepEqual(projectAccountAvatar(config(), {...status,...changed}), {kind:"none"})
  assert.doesNotMatch(JSON.stringify(projectAccountAvatar(config(),status)), /secret|private@example|userInfo|userAccessToken/)
  const missing = config(); Reflect.deleteProperty(missing.auth.oauth.userInfo, "avatar_url")
  assert.deepEqual(projectAccountAvatar(missing,status), {kind:"none"})
  const invalid = config(); invalid.auth.oauth.userInfo.avatar_url="file:///private/avatar"
  assert.deepEqual(projectAccountAvatar(invalid,status), {kind:"unavailable"})
})

it("avatar URLs require HTTPS and the precise CDN allowlist without credentials or alternate ports", () => {
  for (const allowed of [url,"https://feishucdn.com/image", "https://a.larksuitecdn.com/image"]) assert.equal(parseAccountAvatarUrl(allowed),allowed)
  for (const rejected of [null,{},"", "http://s1-imfile.feishucdn.com/x", "https://feishucdn.com.evil.invalid/x", "https://fakefeishucdn.com/x", "https://user:secret@s1-imfile.feishucdn.com/x", "https://feishucdn.com:8080/x", "https://127.0.0.1/x", "data:image/png;base64,x", "file:///tmp/avatar", "https://feishu\ncdn.com/x"]) assert.throws(()=>parseAccountAvatarUrl(rejected))
})

it("matches the pinned CLI's home and BOE profile path; unrelated state-home overrides cannot redirect identity", () => {
  assert.equal(accountProfilePath({},"/cwd","/home/user"),"/home/user/.codem/config.json")
  assert.equal(accountProfilePath({CODEM_HOME:"/custom",CODEM_STATE_HOME:"/wrong"},"/cwd"),"/custom/config.json")
  assert.equal(accountProfilePath({CODEM_HOME:"relative",CODEM_X_TT_ENV:"boe_test"},"/cwd"),"/cwd/relative/.boe/config.json")
  assert.equal(accountProfilePath({CODEM_HOME:"/custom/.boe",CODEM_X_TT_ENV:"boe"},"/cwd"),"/custom/.boe/config.json")
  for(const env of ["ppe","boe_","boe_bad!","production"]) assert.equal(accountProfilePath({CODEM_HOME:"/custom",CODEM_X_TT_ENV:env},"/cwd"),"/custom/config.json")
})

it("profile reads are bounded, cancelable, read-only and report corruption separately from missing avatars", async t => {
  const dir = await mkdtemp(join(tmpdir(),"codem-avatar-")); t.after(()=>rm(dir,{recursive:true,force:true}))
  const path = join(dir,"config.json"); const signal = new AbortController().signal
  assert.deepEqual(await readAccountAvatar(status,path,signal),{kind:"none"})
  await writeFile(path,JSON.stringify(config()))
  assert.deepEqual(await readAccountAvatar(status,path,signal),{kind:"image",url})
  await writeFile(path,"{broken"); assert.deepEqual(await readAccountAvatar(status,path,signal),{kind:"unavailable"})
  await writeFile(path,"x".repeat(1024*1024+1)); assert.deepEqual(await readAccountAvatar(status,path,signal),{kind:"unavailable"})
  await mkdir(join(dir,"directory")); assert.deepEqual(await readAccountAvatar(status,join(dir,"directory"),signal),{kind:"unavailable"})
  const abort = new AbortController(); abort.abort(); await assert.rejects(readAccountAvatar(status,path,abort.signal),{name:"AbortError"})
  assert.deepEqual(await readAccountAvatar({...status,loggedIn:false},path,signal),{kind:"none"})
})
