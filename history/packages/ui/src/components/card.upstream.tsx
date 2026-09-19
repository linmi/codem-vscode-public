import { type ComponentProps, splitProps } from "solid-js"
import { Icon, type IconProps } from "./icon"

type Variant = "normal" | "error" | "warning" | "success" | "info"

export interface CardProps extends ComponentProps<"div"> {
  variant?: Variant
  size?: "default" | "sm"
  padding?: number | string
}

export interface CardTitleProps extends ComponentProps<"div"> {
  variant?: Variant

  /**
   * Optional title icon.
   *
   * - `undefined`: picks a default icon based on `variant` (error/warning/success/info)
   * - `false`/`null`: disables the icon
   * - `Icon` name: forces a specific icon
   */
  icon?: IconProps["name"] | false | null
}

function pick(variant: Variant) {
  if (variant === "error") return "circle-ban-sign" as const
  if (variant === "warning") return "warning" as const
  if (variant === "success") return "circle-check" as const
  if (variant === "info") return "help" as const
  return
}

function mix(
  style: ComponentProps<"div">["style"],
  value?: string,
  extra?: Record<string, string | number | undefined>,
) {
  const vars = {
    ...(value ? { "--card-accent": value } : {}),
    ...Object.fromEntries(Object.entries(extra ?? {}).filter((entry) => entry[1] !== undefined)),
  }
  if (!Object.keys(vars).length) return style
  if (!style) return vars
  if (typeof style === "string") {
    const extraCss = Object.entries(vars)
      .map(([key, item]) => `${key}:${item}`)
      .join(";")
    return extraCss ? `${style};${extraCss};` : style
  }
  return { ...(style as Record<string, string | number>), ...vars }
}

export function Card(props: CardProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "padding", "style", "class", "classList"])
  const variant = () => split.variant ?? "normal"
  const accent = () => {
    const v = variant()
    if (v === "error") return "var(--v2-state-fg-danger)"
    if (v === "warning") return "var(--icon-warning-active)"
    if (v === "success") return "var(--icon-success-active)"
    if (v === "info") return "var(--icon-info-active)"
    return
  }
  const pad = () => (typeof split.padding === "number" ? `${split.padding}px` : split.padding)
  return (
    <div
      {...rest}
      data-component="card"
      data-variant={variant()}
      data-size={split.size ?? "default"}
      style={mix(split.style, accent(), pad() ? { "--card-padding": pad() } : undefined)}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {props.children}
    </div>
  )
}

export function CardTitle(props: CardTitleProps) {
  const [split, rest] = splitProps(props, ["variant", "icon", "class", "classList", "children"])
  const show = () => split.icon !== false && split.icon !== null
  const name = () => {
    if (split.icon === false || split.icon === null) return
    if (typeof split.icon === "string") return split.icon
    return pick(split.variant ?? "normal")
  }
  const placeholder = () => !name()
  return (
    <div
      {...rest}
      data-slot="card-title"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {show() ? (
        <span data-slot="card-title-icon" data-placeholder={placeholder() || undefined}>
          <Icon name={name() ?? "dash"} size="small" />
        </span>
      ) : null}
      {split.children}
    </div>
  )
}

export function CardDescription(props: ComponentProps<"div">) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div
      {...rest}
      data-slot="card-description"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </div>
  )
}

export function CardActions(props: ComponentProps<"div">) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div
      {...rest}
      data-slot="card-actions"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </div>
  )
}
