"use client"

import * as React from "react"
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group"

import { cn } from "./lib/utils"

const toggleGroupItemClasses = {
  variant: {
    default: "bg-transparent",
    outline:
      "border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground",
  },
  size: {
    default: "h-9 px-2 min-w-9",
    sm: "h-8 px-1.5 min-w-8",
    lg: "h-10 px-2.5 min-w-10",
  },
}

const ToggleGroupContext = React.createContext<{
  variant: keyof typeof toggleGroupItemClasses.variant
  size: keyof typeof toggleGroupItemClasses.size
}>({
  variant: "default",
  size: "default",
})

function ToggleGroup({
  className,
  variant = "default",
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & {
  variant?: keyof typeof toggleGroupItemClasses.variant
  size?: keyof typeof toggleGroupItemClasses.size
}) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      className={cn(
        "group/toggle-group flex w-fit items-center rounded-md data-[variant=outline]:shadow-xs",
        className
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & {
  variant?: keyof typeof toggleGroupItemClasses.variant
  size?: keyof typeof toggleGroupItemClasses.size
}) {
  const context = React.useContext(ToggleGroupContext)
  const resolvedVariant = variant ?? context.variant
  const resolvedSize = size ?? context.size

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={resolvedVariant}
      data-size={resolvedSize}
      className={cn(
        "hover:bg-muted hover:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 inline-flex flex-1 shrink-0 items-center justify-center gap-1 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        toggleGroupItemClasses.variant[resolvedVariant],
        toggleGroupItemClasses.size[resolvedSize],
        "data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
        "group-data-[variant=outline]/toggle-group:border-l-0 group-data-[variant=outline]/toggle-group:first:rounded-l-md group-data-[variant=outline]/toggle-group:last:rounded-r-md group-data-[variant=outline]/toggle-group:first:border-l",
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }
