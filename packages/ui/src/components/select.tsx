import { Select as Base, type SelectProps } from "./select.upstream"
import type { ButtonProps } from "./button"
import { changed } from "./select-change"

export * from "./select.upstream"

export function Select<T>(props: SelectProps<T> & Omit<ButtonProps, "children">) {
  const key = (item: T) => (props.value ? props.value(item) : (item as string))

  return (
    <Base
      {...props}
      onSelect={(next) => {
        if (!changed(props.current, next, key)) return
        props.onSelect?.(next)
      }}
    />
  )
}
