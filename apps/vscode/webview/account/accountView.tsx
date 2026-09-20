import { useLayoutEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { createRoot } from "react-dom/client"
import { ArrowLeftIcon, ArrowUpRightIcon, LogOutIcon, RefreshCwIcon, UserRoundIcon } from "lucide-react"
import { Avatar, AvatarImage, AvatarFallback } from "../components/ui/avatar.tsx"
import { Button } from "../components/ui/button.tsx"
import type { AccountAction, AccountAvatar, AccountProfile, AccountState } from "../../src/shared/accountTypes.ts"

function AccountAvatarView({ name, avatar, large = false }: { name: string | null; avatar: AccountAvatar; large?: boolean }) {
  const initial = name?.trim() ? Array.from(name.trim())[0]!.toLocaleUpperCase() : null
  return <Avatar className={`accountAvatar${large ? " accountAvatarLarge" : ""}`} aria-hidden="true">
    {avatar.kind === "image" && <AvatarImage src={avatar.url} alt="" referrerPolicy="no-referrer" />}
    <AvatarFallback>{initial ?? <UserRoundIcon />}</AvatarFallback>
  </Avatar>
}
function Profile({ profile, focusRequest, avatarAttempt, refreshing, notice, back, refresh, logout }: { profile: AccountProfile; focusRequest: number; avatarAttempt: number; refreshing: boolean; notice: string | null; back: () => void; refresh: () => void; logout: () => void }) {
  const backButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => { backButton.current?.focus() }, [focusRequest])
  const fields = [["用户 ID", profile.userId], ["租户 ID", profile.tenantId], ["登录方式", profile.authMethod]] as const
  const status = refreshing ? "正在刷新账户信息…" : notice || (profile.avatar.kind === "unavailable" ? "暂时无法读取头像，可刷新重试。" : null)
  return <section className="accountPage" aria-labelledby="accountTitle" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); back() } }}>
    <header className="accountHeader"><Button ref={backButton} variant="ghost" size="icon" aria-label="返回聊天" onClick={back}><ArrowLeftIcon aria-hidden="true" /></Button><h1 id="accountTitle">个人账户</h1><Button variant="ghost" size="icon" aria-label="刷新账户信息" title="刷新账户信息" disabled={refreshing} onClick={refresh}><RefreshCwIcon aria-hidden="true" /></Button></header>
    <div className="accountProfile">
      <AccountAvatarView key={avatarAttempt} name={profile.displayName} avatar={profile.avatar} large />
      <h2>{profile.displayName?.trim() || "CodeM 用户"}</h2>
      <p className="accountConnected"><span aria-hidden="true" />已登录</p>
      <dl className="accountFields">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "未提供"}</dd></div>)}</dl>
      {status && <p className="accountFootnote" role="status">{status}</p>}
      <div className="accountLogout"><Button type="button" variant="outline" onClick={logout}><LogOutIcon aria-hidden="true" />退出登录</Button><p className="accountFootnote">将结束当前连接并清空草稿，已保存的聊天记录保留。</p></div>
    </div>
  </section>
}

function AccountView({ state, profileOpen, focusRequest, avatarAttempt, open, back, refresh, avatarHost, chat, logo, post }: { state: AccountState; profileOpen: boolean; focusRequest: number; avatarAttempt: number; open: () => void; back: () => void; refresh: () => void; avatarHost: HTMLElement; chat: HTMLElement; logo: string; post: (action: AccountAction) => void }) {
  const authenticated = state.status === "signedIn"
  const avatarButton = useRef<HTMLButtonElement>(null)
  const wasProfileOpen = useRef(false)
  const previousStatus = useRef(state.status)
  const loginButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    chat.hidden = !authenticated || profileOpen
    if (authenticated && !profileOpen && wasProfileOpen.current) avatarButton.current?.focus()
    wasProfileOpen.current = profileOpen
    if ((previousStatus.current === "signingIn" && state.status !== "signingIn") || (previousStatus.current === "signingOut" && state.status !== "signingOut")) {
      if (authenticated) chat.querySelector<HTMLTextAreaElement>("textarea")?.focus()
      else loginButton.current?.focus()
    }
    previousStatus.current = state.status
  }, [authenticated, profileOpen, chat, state.status])
  if (state.status === "signedIn") return <>
    {createPortal(<Button ref={avatarButton} className="accountTrigger" variant="ghost" size="icon" aria-label={`个人账户：${state.profile.displayName || "CodeM 用户"}`} title="个人账户" onClick={open}><AccountAvatarView key={avatarAttempt} name={state.profile.displayName} avatar={state.profile.avatar} /></Button>, avatarHost)}
    {profileOpen && <Profile profile={state.profile} focusRequest={focusRequest} avatarAttempt={avatarAttempt} refreshing={state.refreshing} notice={state.notice} back={back} refresh={refresh} logout={() => post({ type: "signOut" })} />}
  </>
  if (state.status === "signingOut" || state.status === "signOutFailed") return <section className="accountPage accountLogin" aria-label="退出 CodeM">
    <div className="accountLoginContent"><img src={logo} alt="CodeM" width="44" height="44" /><h1>{state.status === "signingOut" ? "正在退出登录…" : "退出未完成"}</h1>
      <p role={state.status === "signingOut" ? "status" : "alert"}>{state.status === "signingOut" ? "正在关闭连接并退出账户。" : state.message}</p>
      {state.status === "signOutFailed" && <Button ref={loginButton} type="button" variant="outline" onClick={() => post({ type: "signOut" })}>重试退出</Button>}
    </div>
  </section>
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
  let state: AccountState = { status: "checking" }
  let profileOpen = false
  let avatarAttempt = 0
  let focusRequest = 0
  const render = () => root.render(<AccountView state={state} profileOpen={profileOpen} focusRequest={focusRequest} avatarAttempt={avatarAttempt} open={open} back={back} refresh={refresh} avatarHost={avatarHost} chat={chat} logo={logo} post={post} />)
  const refresh = () => { avatarAttempt++; render(); post({ type: "refreshAccount" }) }
  const open = () => {
    if (state.status !== "signedIn") return
    focusRequest++
    if (profileOpen) { render(); return }
    profileOpen = true; refresh()
  }
  const back = () => { profileOpen = false; render() }
  render()
  return {
    update(next: AccountState) { state = next; if (state.status !== "signedIn") profileOpen = false; render() },
    open,
  }
}
