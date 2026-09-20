import { useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { createRoot } from "react-dom/client"
import { ArrowLeftIcon, ArrowUpRightIcon, RefreshCwIcon, UserRoundIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import type { AccountAction, AccountProfile, AccountState } from "../../src/shared/accountTypes.ts"

function Avatar({ name, large = false }: { name: string | null; large?: boolean }) {
  const initial = name?.trim() ? Array.from(name.trim())[0]!.toLocaleUpperCase() : null
  return <span className={`accountAvatar${large ? " accountAvatarLarge" : ""}`} aria-hidden="true">{initial ?? <UserRoundIcon />}</span>
}
function Profile({ profile, refreshing, notice, back, refresh }: { profile: AccountProfile; refreshing: boolean; notice: string | null; back: () => void; refresh: () => void }) {
  const backButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => { backButton.current?.focus() }, [])
  const fields = [["用户 ID", profile.userId], ["租户 ID", profile.tenantId], ["登录方式", profile.authMethod]] as const
  return <section className="accountPage" aria-labelledby="accountTitle" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); back() } }}>
    <header className="accountHeader"><Button ref={backButton} variant="ghost" size="icon" aria-label="返回聊天" onClick={back}><ArrowLeftIcon aria-hidden="true" /></Button><h1 id="accountTitle">个人账户</h1><Button variant="ghost" size="icon" aria-label="刷新账户信息" title="刷新账户信息" disabled={refreshing} onClick={refresh}><RefreshCwIcon aria-hidden="true" /></Button></header>
    <div className="accountProfile">
      <Avatar name={profile.displayName} large />
      <h2>{profile.displayName?.trim() || "CodeM 用户"}</h2>
      <p className="accountConnected"><span aria-hidden="true" />已登录</p>
      <dl className="accountFields">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "未提供"}</dd></div>)}</dl>
      <p className="accountFootnote" role="status">{refreshing ? "正在刷新账户信息…" : notice || "账户信息由登录服务提供。"}</p>
    </div>
  </section>
}

function AccountView({ state, avatarHost, chat, logo, post }: { state: AccountState; avatarHost: HTMLElement; chat: HTMLElement; logo: string; post: (action: AccountAction) => void }) {
  const [profileOpen, setProfileOpen] = useState(false)
  const authenticated = state.status === "signedIn"
  const avatarButton = useRef<HTMLButtonElement>(null)
  const wasProfileOpen = useRef(false)
  const previousStatus = useRef(state.status)
  const loginButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    chat.hidden = !authenticated || profileOpen
    if (authenticated && !profileOpen && wasProfileOpen.current) avatarButton.current?.focus()
    wasProfileOpen.current = profileOpen
    if (!authenticated) setProfileOpen(false)
    if (previousStatus.current === "signingIn" && state.status !== "signingIn") {
      if (authenticated) chat.querySelector<HTMLTextAreaElement>("textarea")?.focus()
      else loginButton.current?.focus()
    }
    previousStatus.current = state.status
  }, [authenticated, profileOpen, chat, state.status])
  if (state.status === "signedIn") return <>
    {createPortal(<Button ref={avatarButton} className="accountTrigger" variant="ghost" size="icon" aria-label={`个人账户：${state.profile.displayName || "CodeM 用户"}`} title="个人账户" onClick={() => { setProfileOpen(true); post({ type: "refreshAccount" }) }}><Avatar name={state.profile.displayName} /></Button>, avatarHost)}
    {profileOpen && <Profile profile={state.profile} refreshing={state.refreshing} notice={state.notice} back={() => setProfileOpen(false)} refresh={() => post({ type: "refreshAccount" })} />}
  </>
  const signingIn = state.status === "signingIn"
  const progress = signingIn ? ({ opening: "正在打开登录页面…", waiting: "请在浏览器中完成登录", binding: "正在确认登录…", cancelling: "正在取消登录…" } as const)[state.progress] : null
  return <section className="accountPage accountLogin" aria-label="登录 CodeM">
    <div className="accountLoginContent">
      <img src={logo} alt="CodeM" width="44" height="44" />
      {state.status === "checking" && <span className="sr-only" role="status">正在检查登录状态</span>}
      {state.status !== "checking" && <>
        <h1>登录 CodeM</h1><p>登录后，开始与你的代码协作。</p>
        <div className="accountLoginActions">
          {signingIn ? <><p role="status">{progress}</p><Button variant="outline" disabled={state.progress === "cancelling"} onClick={() => post({ type: "cancelSignIn" })}>取消登录</Button></> : <>
            <Button ref={loginButton} className="accountLoginButton" onClick={() => post({ type: "signIn" })}>登录 CodeM<ArrowUpRightIcon aria-hidden="true" /></Button>
            <p className="accountFootnote">将在浏览器中安全完成登录</p>
          </>}
        </div>
        {state.status === "signedOut" && state.notice && <p className="accountNotice" role="status">{state.notice}</p>}
        {state.status === "error" && <div className="accountNotice" role="alert"><p>{state.message}</p><Button variant="ghost" onClick={() => post({ type: "refreshAccount" })}>重新检查登录状态</Button></div>}
      </>}
    </div>
  </section>
}

export function createAccountView(host: HTMLElement, avatarHost: HTMLElement, chat: HTMLElement, logo: string, post: (action: AccountAction) => void) {
  const root = createRoot(host)
  const render = (state: AccountState) => root.render(<AccountView state={state} avatarHost={avatarHost} chat={chat} logo={logo} post={post} />)
  render({ status: "checking" })
  return render
}
