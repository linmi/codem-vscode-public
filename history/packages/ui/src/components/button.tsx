import { Button as Kobalte } from "@kobalte/core/button"
import { type ComponentProps, Show, splitProps } from "solid-js"
import { Icon, IconProps } from "./icon"

// Console aliases (xs/sm/lg, default/outline/destructive/link) map onto the
// CodeM size and variant tokens so editor and Console share one Button.
type Size = "xs" | "sm" | "small" | "normal" | "default" | "large" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"
type Variant = "primary" | "secondary" | "ghost" | "default" | "outline" | "destructive" | "link"

export interface ButtonProps
  extends ComponentProps<typeof Kobalte>,
    Pick<ComponentProps<"button">, "class" | "classList" | "children"> {
  size?: Size
  variant?: Variant
  icon?: IconProps["name"]
}

function size(value: Size | undefined) {
  if (!value || value === "normal" || value === "default") return "normal"
  if (value === "small" || value === "sm" || value === "xs") return "small"
  if (value === "large" || value === "lg") return "large"
  return value
}

function variant(value: Variant | undefined) {
  if (value === "default") return "primary"
  return value || "secondary"
}

export function Button(props: ButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "icon", "class", "classList"])
  return (
    <Kobalte
      {...rest}
      data-component="button"
      data-size={size(split.size)}
      data-variant={variant(split.variant)}
      data-icon={split.icon}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <Show when={split.icon}>
        <Icon name={split.icon!} size="small" />
      </Show>
      {props.children}
    </Kobalte>
  )
}

export function buttonVariants() {
  return ""
}
