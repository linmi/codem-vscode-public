import { useEffect, useRef, useState, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { createPortal } from "react-dom"
import { CheckIcon } from "lucide-react"
import { parseCodemPermissionMode } from "@codem/protocol"
import { permissions, workModes, parseWorkMode, type ComposerChoice } from "../../src/shared/composerSettings.ts"
import { initialSnapshot, isBusy, type ChatSnapshot, type ViewAction } from "../../src/shared/messages.ts"
import { uiIcon, permissionIcons } from "../../src/shared/uiIcons.ts"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger } from "../components/ui/select.tsx"
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover.tsx"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../components/ui/command.tsx"
import { Button } from "../components/ui/button.tsx"
import { ComposerMenuHeading } from "./composerMenuHeading.tsx"

type MenuName = "permission" | "workMode" | "model" | "space" | "attachment"
const icon = (name: Parameters<typeof uiIcon>[0]) => <span className="composerMenuIcon" dangerouslySetInnerHTML={{ __html: uiIcon(name) }} />
function FixedMenu({ id, title, label, value, choices, children, enabled, open, onOpenChange, select, className, scope }: { scope: string; id: string; title: string; label: string; value: string; choices: readonly { value: string; label: string; description: string }[]; children: ReactNode; enabled: boolean; open: boolean; onOpenChange: (open: boolean) => void; select: (value: string) => void; className?: string }) {
  return <Select value={value} open={open} onOpenChange={onOpenChange} disabled={!enabled} onValueChange={select}>
    <SelectTrigger id={id} data-menu-scope={scope} data-mode={id === "selectPermission" ? value : undefined} className={`composerMenuTrigger ${className ?? "optionButton"}`} aria-label={label} title={label}>{children}</SelectTrigger>
    <SelectContent className={`composerPickerMenu composerChoiceMenu${id === "selectWorkMode" ? " composerWorkModeMenu" : ""}`} position="popper" side="top" align="end" sideOffset={8} collisionPadding={12}>
      <SelectGroup><ComposerMenuHeading close={() => onOpenChange(false)}><SelectLabel>{title}</SelectLabel></ComposerMenuHeading>{choices.map(choice => <SelectItem key={choice.value} className={id === "selectPermission" && choice.value === "yolo" ? "composerPermissionWarning" : undefined} value={choice.value} textValue={choice.label}>{id === "selectPermission" && icon(permissionIcons[parseCodemPermissionMode(choice.value)])}<span className="composerChoiceText"><span>{choice.label}</span><small>{choice.description}</small></span></SelectItem>)}</SelectGroup>
    </SelectContent>
  </Select>
}
function CatalogMenu({ id, title, choices, children, enabled, open, onOpenChange, select, connect, refresh, scope }: { scope: string; id: string; title: string; choices: readonly ComposerChoice[]; children: ReactNode; enabled: boolean; open: boolean; onOpenChange: (open: boolean) => void; select: (id: string) => void; connect: (() => void) | null; refresh?: () => void }) {
  const search = useRef<HTMLInputElement>(null)
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild><Button id={id} data-menu-scope={scope} variant="ghost" className={`composerMenuTrigger ${id === "selectSpace" ? "spaceButton" : "optionButton"}`} disabled={!enabled} aria-busy={!enabled} aria-label={`选择${title}`} title={`选择${title}`}>{children}</Button></PopoverTrigger>
    <PopoverContent className="composerPickerMenu composerCatalogMenu" side="top" align="end" sideOffset={8} collisionPadding={12} aria-label={title} onOpenAutoFocus={event => { event.preventDefault(); search.current?.focus() }}>
      <ComposerMenuHeading close={() => onOpenChange(false)}><h2>{title}</h2></ComposerMenuHeading>
      <Command defaultValue={choices.find(choice => choice.selected)?.label}><CommandInput ref={search} placeholder={`搜索${title}…`} aria-label={`搜索${title}`} /><CommandList>
        <CommandEmpty>{choices.length ? "没有匹配的选项" : `尚未加载${title}，连接或发送消息后可用。`}</CommandEmpty>
        {choices.map(choice => <CommandItem key={choice.id} value={choice.label} data-current={choice.selected} onSelect={() => select(choice.id)}><span className="composerChoiceText"><span>{choice.label}</span>{choice.description && <small>{choice.description}</small>}</span>{choice.selected && <CheckIcon aria-label="当前选项" />}</CommandItem>)}
      </CommandList></Command>
      {connect && <Button type="button" variant="ghost" className="composerCatalogAction" onClick={connect}>连接并加载{title}</Button>}
      {refresh && <Button type="button" variant="ghost" className="composerCatalogAction" onClick={refresh}>刷新空间列表</Button>}
    </PopoverContent>
  </Popover>
}
type MenuHosts = Record<MenuName, HTMLElement>
function ComposerMenus({ state, post, hosts, logo }: { state: ChatSnapshot; post: (action: ViewAction) => void; hosts: MenuHosts; logo: string }) {
  const [active, setActive] = useState<MenuName | null>(null)
  const enabled = !isBusy(state.phase) && !state.backgroundBusy && !state.sessionTools.busy
  useEffect(() => { if (!enabled) setActive(null) }, [enabled])
  const menu = (name: MenuName) => ({ scope: JSON.stringify([state.workspace, state.space, state.threadId]), enabled, open: enabled && active === name, onOpenChange: (open: boolean) => setActive(open ? name : null) })
  const send = (action: ViewAction) => { setActive(null); post(action) }
  const disconnected = state.phase === "disconnected"
  return <>
    {createPortal(<FixedMenu {...menu("permission")} id="selectPermission" title="权限模式" label={`权限模式：${permissions.find(item => item.value === state.permission)!.label}`} value={state.permission} choices={permissions} className="composerIconTrigger permission" select={value => send({ type: "setPermission", permission: parseCodemPermissionMode(value) })}>{icon(permissionIcons[state.permission])}</FixedMenu>, hosts.permission)}
    {createPortal(<FixedMenu {...menu("workMode")} id="selectWorkMode" title="工作模式" label="切换工作模式" value={state.workMode} choices={workModes} select={value => send({ type: "setWorkMode", workMode: parseWorkMode(value) })}>{state.workMode === "plan" ? "Plan" : "Agent"}</FixedMenu>, hosts.workMode)}
    {createPortal(<FixedMenu {...menu("attachment")} id="addAttachment" title="添加附件" label="添加附件" value="" choices={[{ value: "file", label: "文件或图片", description: "选择本地文件" }, { value: "directory", label: "文件夹", description: "选择本地文件夹" }]} className="composerIconTrigger" select={value => { if (value === "file" || value === "directory") send({ type: "pickAttachment", kind: value }) }}>{icon("plus")}</FixedMenu>, hosts.attachment)}
    {createPortal(<CatalogMenu {...menu("model")} id="selectModel" title="模型" choices={state.composerCatalog.models} select={id => send({ type: "chooseModel", id })} connect={disconnected ? () => send({ type: "connect" }) : null}><img src={logo} alt="" width="14" height="14" /><span id="model" title={state.model ?? "连接后使用 Core 当前模型"}>{!state.model || state.model.endsWith("/auto") ? "Auto" : state.model}</span></CatalogMenu>, hosts.model)}
    {createPortal(<CatalogMenu {...menu("space")} id="selectSpace" title="空间" choices={state.composerCatalog.spaces} select={id => send({ type: "chooseSpace", id })} connect={disconnected ? () => send({ type: "connect" }) : null} refresh={disconnected ? undefined : () => send({ type: "refreshSpaces" })}>{icon("space")}<span id="space">{state.space ?? "选择空间"}</span>{icon("chevronDown")}</CatalogMenu>, hosts.space)}
  </>
}
export function createComposerMenus(host: HTMLElement, hosts: MenuHosts, logo: string, post: (action: ViewAction) => void) {
  const root = createRoot(host)
  // One menu owner; portals keep controls in the existing toolbar layout.
  const render = (state: ChatSnapshot) => root.render(<ComposerMenus key={`${state.workspace}:${state.space}:${state.threadId}`} hosts={hosts} logo={logo} state={state} post={post} />)
  render(initialSnapshot())
  return render
}
