import { type ComponentProps, splitProps } from "solid-js"

export * from "./card.upstream"

export function CardHeader(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["children", "class", "classList"])
  return (
    <div {...rest} data-slot="card-header" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}

export function CardAction(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot="card-action" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}

export function CardContent(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot="card-content" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}

export function CardFooter(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div {...rest} data-slot="card-footer" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}
