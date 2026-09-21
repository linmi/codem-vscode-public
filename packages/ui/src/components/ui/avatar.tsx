// Adapted from shadcn/ui new-york-v4 (MIT). See shadcnLicense.md.
import type { ComponentProps } from "react"
import { Avatar as AvatarPrimitive } from "radix-ui"
import { cn } from "../utils.ts"

function Avatar({ className, ...props }: ComponentProps<typeof AvatarPrimitive.Root>) {
  return <AvatarPrimitive.Root data-slot="avatar" className={cn("relative flex size-8 shrink-0 overflow-hidden rounded-full select-none", className)} {...props} />
}

function AvatarImage({ className, ...props }: ComponentProps<typeof AvatarPrimitive.Image>) {
  return <AvatarPrimitive.Image data-slot="avatar-image" className={cn("aspect-square size-full object-cover", className)} {...props} />
}

function AvatarFallback({ className, ...props }: ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return <AvatarPrimitive.Fallback data-slot="avatar-fallback" className={cn("flex size-full items-center justify-center rounded-full bg-muted text-muted-foreground", className)} {...props} />
}

export { Avatar, AvatarImage, AvatarFallback }
