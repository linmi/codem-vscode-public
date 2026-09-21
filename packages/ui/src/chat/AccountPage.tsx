import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowLeftIcon, ArrowUpRightIcon, LogOutIcon, RefreshCwIcon, UserRoundIcon } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar.tsx"
import { Button } from "../components/ui/button.tsx"
import { isSignedIn, type AccountProfile, type AccountState } from "../contract.ts"

/**
 * 对照 VS Code accountView + account.css。
 * 状态来自 Host 投影；动作只有 signIn/signOut/cancelSignIn/refreshAccount。
 *
 * 更改要点：checking 立刻显示「正在检查登录」，超时露出重试，不再只剩 Logo。
 */
export function AccountPage({
  account,
  brandMark,
  focusRequest,
  onBack,
  post,
}: {
  account: AccountState
  brandMark: string | null
  focusRequest: number
  onBack: () => void
  post: (action: Record<string, unknown>) => void
}) {
  if (isSignedIn(account)) {
    return (
      <ProfilePage
        profile={account.profile}
        refreshing={account.refreshing}
        notice={account.notice}
        focusRequest={focusRequest}
        onBack={onBack}
        onRefresh={() => post({ type: "refreshAccount" })}
        onSignOut={() => post({ type: "signOut" })}
      />
    )
  }
  if (account.status === "signingOut" || account.status === "signOutFailed") {
    return (
      <section className="accountPage accountLogin" data-testid="accountPage" data-status={account.status} aria-label="退出 CodeM">
        <div className="accountLoginContent">
          <Brand mark={brandMark} />
          <h1>{account.status === "signingOut" ? "正在退出登录…" : "退出未完成"}</h1>
          <p role={account.status === "signingOut" ? "status" : "alert"}>
            {account.status === "signingOut" ? "正在关闭连接并退出账户。" : account.message}
          </p>
          {account.status === "signOutFailed" ? (
            <Button type="button" variant="outline" data-testid="retrySignOut" onClick={() => post({ type: "signOut" })}>重试退出</Button>
          ) : null}
        </div>
      </section>
    )
  }
  const signingIn = account.status === "signingIn"
  const progress = signingIn
    ? ({ opening: "正在打开登录页面…", waiting: "请在浏览器中完成登录", binding: "正在确认登录…", cancelling: "正在取消登录…" } as const)[account.progress]
    : null
  return (
    <section className="accountPage accountLogin" data-testid="accountPage" data-status={account.status} aria-label="登录 CodeM">
      <div className="accountLoginContent">
        <Brand mark={brandMark} />
        {account.status === "checking" ? (
          <CheckingStatus onRetry={() => post({ type: "refreshAccount" })} />
        ) : (
          <>
            <h1>登录 CodeM</h1>
            <p>登录后，开始与你的代码协作。</p>
            <div className="accountLoginActions">
              {signingIn ? (
                <>
                  <p role="status" data-testid="signInProgress">{progress}</p>
                  <Button type="button" variant="outline" data-testid="cancelSignIn" disabled={account.progress === "cancelling"} onClick={() => post({ type: "cancelSignIn" })}>
                    取消登录
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" className="accountLoginButton" data-testid="signIn" onClick={() => post({ type: "signIn" })}>
                    登录 CodeM
                    <ArrowUpRightIcon aria-hidden="true" />
                  </Button>
                  <p className="accountFootnote">将在浏览器中安全完成登录</p>
                </>
              )}
            </div>
            {account.status === "signedOut" && account.notice ? <p className="accountNotice" role="status">{account.notice}</p> : null}
            {account.status === "error" ? (
              <div className="accountNotice" role="alert">
                <p>{account.message}</p>
                <Button type="button" variant="ghost" data-testid="refreshAccount" onClick={() => post({ type: "refreshAccount" })}>重新检查登录状态</Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}

/** Host 卡住时 8s 后仍露出重试；不靠屏幕外文字，也不提前闪登录按钮。 */
function CheckingStatus({ onRetry }: { onRetry: () => void }) {
  const [stale, setStale] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setStale(true), 8_000)
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <>
      <h1>正在检查登录状态</h1>
      <p role="status" data-testid="accountChecking">
        {stale ? "检查登录状态时间过长。" : "正在读取本机登录信息…"}
      </p>
      {stale ? (
        <div className="accountLoginActions">
          <Button type="button" variant="outline" data-testid="refreshAccount" onClick={onRetry}>
            重新检查登录状态
          </Button>
        </div>
      ) : null}
    </>
  )
}

export function AccountTrigger({
  account,
  onOpen,
}: {
  account: Extract<AccountState, { status: "signedIn" }>
  onOpen: () => void
}) {
  const name = account.profile.displayName?.trim() || "CodeM 用户"
  return (
    <Button type="button" variant="ghost" size="icon" className="accountTrigger" data-testid="accountTrigger" aria-label={`个人账户：${name}`} title="个人账户" onClick={onOpen}>
      <AccountAvatar profile={account.profile} />
    </Button>
  )
}

function ProfilePage({
  profile,
  refreshing,
  notice,
  focusRequest,
  onBack,
  onRefresh,
  onSignOut,
}: {
  profile: AccountProfile
  refreshing: boolean
  notice: string | null
  focusRequest: number
  onBack: () => void
  onRefresh: () => void
  onSignOut: () => void
}) {
  const back = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    back.current?.focus()
  }, [focusRequest])
  const fields = [
    ["用户 ID", profile.userId],
    ["租户 ID", profile.tenantId],
    ["登录方式", profile.authMethod],
  ] as const
  const status = refreshing ? "正在刷新账户信息…" : notice || (profile.avatar.kind === "unavailable" ? "暂时无法读取头像，可刷新重试。" : null)
  return (
    <section
      className="accountPage"
      data-testid="accountPage"
      data-status="signedIn"
      aria-labelledby="accountTitle"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          onBack()
        }
      }}
    >
      <header className="accountHeader">
        <Button ref={back} type="button" variant="ghost" size="icon" data-testid="accountBack" aria-label="返回聊天" onClick={onBack}>
          <ArrowLeftIcon aria-hidden="true" />
        </Button>
        <h1 id="accountTitle">个人账户</h1>
        <Button type="button" variant="ghost" size="icon" data-testid="refreshAccount" aria-label="刷新账户信息" title="刷新账户信息" disabled={refreshing} onClick={onRefresh}>
          <RefreshCwIcon aria-hidden="true" />
        </Button>
      </header>
      <div className="accountProfile">
        <AccountAvatar profile={profile} large />
        <h2>{profile.displayName?.trim() || "CodeM 用户"}</h2>
        <p className="accountConnected"><span aria-hidden="true" />已登录</p>
        <dl className="accountFields">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value || "未提供"}</dd>
            </div>
          ))}
        </dl>
        {status ? <p className="accountFootnote" role="status">{status}</p> : null}
        <div className="accountLogout">
          <Button type="button" variant="outline" data-testid="signOut" onClick={onSignOut}>
            <LogOutIcon aria-hidden="true" />
            退出登录
          </Button>
          <p className="accountFootnote">将结束当前连接并清空草稿，已保存的聊天记录保留。</p>
        </div>
      </div>
    </section>
  )
}

function AccountAvatar({ profile, large = false }: { profile: AccountProfile; large?: boolean }) {
  const initial = profile.displayName?.trim() ? Array.from(profile.displayName.trim())[0]!.toLocaleUpperCase() : null
  return (
    <Avatar className={large ? "accountAvatar accountAvatarLarge" : "accountAvatar"} aria-hidden="true">
      {profile.avatar.kind === "image" ? <AvatarImage src={profile.avatar.url} alt="" referrerPolicy="no-referrer" /> : null}
      <AvatarFallback>{initial ?? <UserRoundIcon />}</AvatarFallback>
    </Avatar>
  )
}

function Brand({ mark }: { mark: string | null }) {
  return mark ? <img src={mark} alt="CodeM" width="44" height="44" /> : <p className="accountLoginContent">CodeM</p>
}
