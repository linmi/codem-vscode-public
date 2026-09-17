import { Button as Kobalte } from "@kobalte/core/button"
import { Show, type ComponentProps, splitProps } from "solid-js"
import { Icon, IconProps } from "./icon"
import { Spinner } from "./spinner"

// Console aliases (icon sizes, default/outline/destructive, active) sit on the
// CodeM IconButton so editor loading/tone behavior and Console chrome share one export.
type Size = "small" | "normal" | "large" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"
type Variant = "primary" | "secondary" | "ghost" | "default" | "outline" | "destructive"

export interface IconButtonProps extends ComponentProps<typeof Kobalte> {
  icon: IconProps["name"]
  size?: Size
  iconSize?: IconProps["size"]
  variant?: Variant
  shape?: "circle"
  tone?: "danger" | "success"
  label?: string
  loading?: boolean
  active?: boolean
}

function size(value: Size | undefined) {
  if (!value || value === "normal") return "normal"
  return value
}

function variant(value: Variant | undefined) {
  if (!value || value === "default") return "secondary"
  return value
}

export function IconButton(props: ComponentProps<"button"> & IconButtonProps) {
  const [split, rest] = splitProps(props, [
    "icon",
    "variant",
    "shape",
    "size",
    "iconSize",
    "tone",
    "class",
    "classList",
    "label",
    "loading",
    "active",
    "children",
  ])
  const label = () => props["aria-label"] ?? split.label ?? props.icon
  const busy = () => split.loading === true
  const disabled = () => props.disabled === true || busy()
  const aria = () => (disabled() ? "true" : (props["aria-disabled"] ?? "false"))
  const iconSize = () => split.iconSize ?? (split.size === "large" || split.size === "icon-lg" ? "normal" : "small")
  return (
    <Kobalte
      {...rest}
      data-component="icon-button"
      data-icon={props.icon}
      data-size={size(split.size)}
      data-variant={variant(split.variant)}
      data-shape={split.shape}
      data-tone={split.tone}
      data-active={split.active || undefined}
      data-content={split.children != null ? "true" : undefined}
      data-loading={busy() ? "true" : undefined}
      type={props.type ?? "button"}
      aria-label={label()}
      aria-pressed={split.active || undefined}
      aria-busy={busy() || props["aria-busy"]}
      aria-disabled={aria()}
      disabled={disabled()}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <Show
        when={!busy()}
        fallback={
          <Spinner
            class="icon-button-spinner"
            style={{ width: split.iconSize === "normal" ? "20px" : split.iconSize === "medium" ? "24px" : "16px" }}
          />
        }
      >
        <Icon name={props.icon} size={iconSize()} />
      </Show>
      {split.children}
    </Kobalte>
  )
}
