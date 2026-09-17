import { type ComponentProps, splitProps } from "solid-js"

type Tone = "neutral" | "success" | "warning" | "critical" | "info" | "brand"

export interface TagProps extends ComponentProps<"span"> {
  size?: "normal" | "large"
  tone?: Tone
}

export function Tag(props: TagProps) {
  const [split, rest] = splitProps(props, ["size", "tone", "class", "classList", "children"])
  return (
    <span
      {...rest}
      data-component="tag"
      data-size={split.size || "normal"}
      data-tone={split.tone ?? "neutral"}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </span>
  )
}

export function CountTag(props: ComponentProps<"span">) {
  return <Tag {...props} tone="neutral" />
}
