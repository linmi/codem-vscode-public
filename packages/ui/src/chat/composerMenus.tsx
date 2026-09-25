import { useMemo, useRef, type ReactNode } from "react"
import { CheckIcon } from "lucide-react"
import { CODEM_BUILTIN_INTELLIGENCE_TIERS, CODEM_DEFAULT_INTELLIGENCE, type CodemPermissionMode } from "@codem/protocol"
import { Button } from "../components/ui/button.tsx"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../components/ui/command.tsx"
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover.tsx"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger } from "../components/ui/select.tsx"
import { permissions, workModes, type ChatSnapshot, type ComposerChoice } from "../contract.ts"
import { ComposerMenuHeading } from "./composerMenuHeading.tsx"
import { permissionIcons, uiIcon, type UiIconName } from "./uiIcons.ts"

/** 输入栏各菜单的名称；同一时间最多展开一个，由 ChatApp 持有。 */
export type MenuName = "permission" | "workMode" | "model" | "space" | "attachment" | "effort"

/** 固定菜单的一项。图标和警示色随选项声明，不按触发器 id 推断。 */
interface FixedChoice<T extends string> {
  value: T
  label: string
  description: string
  icon?: UiIconName
  warning?: boolean
}

function MenuIcon({ name }: { name: UiIconName }) {
  return <span className="composerMenuIcon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: uiIcon(name) }} />
}

function FixedMenu<T extends string>({
  id,
  title,
  label,
  value,
  choices,
  children,
  enabled,
  open,
  onOpenChange,
  select,
  className,
  menuClassName,
  mode,
}: {
  id: string
  title: string
  label: string
  value: T | ""
  choices: readonly FixedChoice<T>[]
  children: ReactNode
  enabled: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  select: (value: T) => void
  className?: string
  /** 菜单面板的附加类名，用于宽度等变体。 */
  menuClassName?: string
  /** 写到触发器 data-mode，供样式区分当前取值。 */
  mode?: T
}) {
  return (
    <Select
      value={value}
      open={open}
      onOpenChange={onOpenChange}
      disabled={!enabled}
      onValueChange={(next) => {
        const choice = choices.find((item) => item.value === next)
        if (choice) select(choice.value)
      }}
    >
      <SelectTrigger
        id={id}
        data-mode={mode}
        className={`composerMenuTrigger ${className ?? "optionButton"}`}
        aria-label={label}
        title={label}
      >
        {children}
      </SelectTrigger>
      <SelectContent
        className={`composerPickerMenu composerChoiceMenu${menuClassName ? ` ${menuClassName}` : ""}`}
        position="popper"
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
      >
        <SelectGroup>
          <ComposerMenuHeading close={() => onOpenChange(false)}>
            <SelectLabel>{title}</SelectLabel>
          </ComposerMenuHeading>
          {choices.map((choice) => (
            <SelectItem
              key={choice.value}
              className={choice.warning ? "composerPermissionWarning" : undefined}
              value={choice.value}
              textValue={choice.label}
            >
              {choice.icon ? <MenuIcon name={choice.icon} /> : null}
              <span className="composerChoiceText">
                <span>{choice.label}</span>
                <small>{choice.description}</small>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function CatalogMenu({
  id,
  title,
  choices,
  children,
  enabled,
  open,
  onOpenChange,
  select,
  connect,
  refresh,
  className,
}: {
  id: string
  title: string
  choices: readonly ComposerChoice[]
  children: ReactNode
  enabled: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  select: (id: string) => void
  connect: (() => void) | null
  refresh?: () => void
  className: string
}) {
  const search = useRef<HTMLInputElement>(null)
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="ghost"
          className={`composerMenuTrigger ${className}`}
          disabled={!enabled}
          aria-busy={!enabled}
          aria-label={`选择${title}`}
          title={`选择${title}`}
        >
          {children}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="composerPickerMenu composerCatalogMenu"
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        aria-label={title}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          search.current?.focus()
        }}
      >
        <ComposerMenuHeading close={() => onOpenChange(false)}>
          <h2>{title}</h2>
        </ComposerMenuHeading>
        <Command defaultValue={choices.find((choice) => choice.selected)?.label}>
          <CommandInput ref={search} placeholder={`搜索${title}…`} aria-label={`搜索${title}`} />
          <CommandList>
            <CommandEmpty>{choices.length ? "没有匹配的选项" : `尚未加载${title}，连接或发送消息后可用。`}</CommandEmpty>
            {choices.map((choice) => (
              <CommandItem key={choice.id} value={choice.label} data-current={choice.selected} onSelect={() => select(choice.id)}>
                <span className="composerChoiceText">
                  <span>{choice.label}</span>
                  {choice.description ? <small>{choice.description}</small> : null}
                </span>
                {choice.selected ? <CheckIcon aria-label="当前选项" /> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
        {connect ? (
          <Button type="button" variant="ghost" className="composerCatalogAction" onClick={connect}>
            连接并加载{title}
          </Button>
        ) : null}
        {refresh ? (
          <Button type="button" variant="ghost" className="composerCatalogAction" onClick={refresh}>
            刷新空间列表
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

const attachmentChoices: readonly FixedChoice<"file" | "directory">[] = [
  { value: "file", label: "文件或图片", description: "选择本地文件" },
  { value: "directory", label: "文件夹", description: "选择本地文件夹" },
]

/** 完全访问跳过审批，用警示色标出。 */
const permissionChoices: readonly FixedChoice<CodemPermissionMode>[] = permissions.map((choice) => ({
  ...choice,
  icon: permissionIcons[choice.value],
  warning: choice.value === "yolo",
}))

/**
 * 对照 VS Code composerMenus + effortSelector：
 * 左附件/模式，右权限/思考/模型，底栏空间；模型与空间是可搜索目录，不是原生 select。
 */
export function ComposerMenus({
  snapshot,
  enabled,
  openMenu,
  setOpenMenu,
  post,
  region,
}: {
  snapshot: ChatSnapshot
  enabled: boolean
  openMenu: MenuName | null
  setOpenMenu: (name: MenuName | null) => void
  post: (action: Record<string, unknown>) => void
  region: "leading" | "trailing" | "space"
}) {
  const menu = (name: MenuName) => ({
    enabled,
    open: enabled && openMenu === name,
    onOpenChange: (open: boolean) => setOpenMenu(open ? name : null),
  })
  const send = (action: Record<string, unknown>) => {
    setOpenMenu(null)
    post(action)
  }
  const disconnected = snapshot.phase === "disconnected"
  const models = useMemo(() => {
    if (snapshot.composerCatalog.models.length) return snapshot.composerCatalog.models
    if (snapshot.model) {
      return [{ id: snapshot.model, label: snapshot.model.endsWith("/auto") ? "Auto" : snapshot.model, description: "", selected: true }]
    }
    return []
  }, [snapshot.composerCatalog.models, snapshot.model])
  const spaces = useMemo(() => {
    if (snapshot.composerCatalog.spaces.length) return snapshot.composerCatalog.spaces
    if (snapshot.space) return [{ id: snapshot.space, label: snapshot.space, description: "", selected: true }]
    return []
  }, [snapshot.composerCatalog.spaces, snapshot.space])
  const effortLevel = Math.max(0, CODEM_BUILTIN_INTELLIGENCE_TIERS.indexOf(snapshot.effort))
  const modelLabel = models.find((item) => item.selected)?.label ?? (snapshot.model?.endsWith("/auto") ? "Auto" : snapshot.model) ?? "Auto"
  const spaceLabel = spaces.find((item) => item.selected)?.label ?? snapshot.space ?? "选择空间"

  if (region === "leading") {
    return (
      <>
        <span id="attachmentMenu">
          <FixedMenu
            {...menu("attachment")}
            id="addAttachment"
            title="添加附件"
            label="添加附件"
            value=""
            choices={attachmentChoices}
            className="composerIconTrigger"
            select={(kind) => send({ type: "pickAttachment", kind })}
          >
            <MenuIcon name="plus" />
          </FixedMenu>
        </span>
        <span id="workModeMenu">
          <FixedMenu
            {...menu("workMode")}
            id="selectWorkMode"
            title="工作模式"
            label="切换工作模式"
            value={snapshot.workMode}
            choices={workModes}
            menuClassName="composerWorkModeMenu"
            select={(workMode) => send({ type: "setWorkMode", workMode })}
          >
            {snapshot.workMode === "plan" ? "Plan" : "Agent"}
          </FixedMenu>
        </span>
      </>
    )
  }

  if (region === "space") {
    return (
      <span id="spaceMenu">
        <CatalogMenu
          {...menu("space")}
          id="selectSpace"
          title="空间"
          choices={spaces}
          className="spaceButton"
          select={(id) => send({ type: "chooseSpace", id })}
          connect={disconnected ? () => send({ type: "connect" }) : null}
          refresh={disconnected ? undefined : () => send({ type: "refreshSpaces" })}
        >
          <MenuIcon name="space" />
          <span id="space">{spaceLabel}</span>
          <MenuIcon name="chevronDown" />
        </CatalogMenu>
      </span>
    )
  }

  return (
    <>
      <span id="permissionMenu">
        <FixedMenu
          {...menu("permission")}
          id="selectPermission"
          title="权限模式"
          label={`权限模式：${permissions.find((item) => item.value === snapshot.permission)?.label ?? snapshot.permission}`}
          value={snapshot.permission}
          mode={snapshot.permission}
          choices={permissionChoices}
          className="composerIconTrigger permission"
          select={(permission) => send({ type: "setPermission", permission })}
        >
          <MenuIcon name={permissionIcons[snapshot.permission]} />
        </FixedMenu>
      </span>
      <span id="effortSelector">
        <Select
          value={snapshot.effort}
          open={enabled && openMenu === "effort"}
          onOpenChange={(open) => setOpenMenu(open ? "effort" : null)}
          disabled={!enabled}
          onValueChange={(value) => send({ type: "setEffort", effort: value })}
        >
          <SelectTrigger id="selectEffort" className="effortTrigger" aria-label={`思考强度：${snapshot.effort}`} title={`思考强度：${snapshot.effort}`}>
            <span>
              <svg className="effortSignal" data-effort={snapshot.effort} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                {CODEM_BUILTIN_INTELLIGENCE_TIERS.map((tier, index) => (
                  <path key={tier} data-active={index <= effortLevel} opacity={index <= effortLevel ? 1 : 0.2} d={`M${5 + index * 5} 19V${16 - index * 4}`} />
                ))}
              </svg>
            </span>
          </SelectTrigger>
          <SelectContent className="composerPickerMenu effortMenu" position="popper" side="top" align="end" sideOffset={8} collisionPadding={12}>
            <SelectGroup>
              <ComposerMenuHeading close={() => setOpenMenu(null)}>
                <SelectLabel>思考强度</SelectLabel>
              </ComposerMenuHeading>
              {CODEM_BUILTIN_INTELLIGENCE_TIERS.map((tier) => (
                <SelectItem key={tier} value={tier} textValue={tier}>
                  {tier}
                  {tier === CODEM_DEFAULT_INTELLIGENCE ? <span className="effortDefault">默认</span> : null}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </span>
      <span id="modelMenu">
        <CatalogMenu
          {...menu("model")}
          id="selectModel"
          title="模型"
          choices={models}
          className="optionButton"
          select={(id) => send({ type: "chooseModel", id })}
          connect={disconnected ? () => send({ type: "connect" }) : null}
        >
          {snapshot.brandMark ? <img src={snapshot.brandMark} alt="" width="14" height="14" /> : null}
          <span id="model" title={snapshot.model ?? "连接后使用 Core 当前模型"}>
            {modelLabel}
          </span>
        </CatalogMenu>
      </span>
    </>
  )
}
