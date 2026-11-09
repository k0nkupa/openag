import * as React from "react"
import { cn } from "cn"

function Textarea({ className, variant = "default", ...props }: React.ComponentProps<"textarea"> & { variant?: "default" | "composer" }) {
  return (
    <textarea
      data-slot="textarea"
      data-variant={variant}
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        "data-[variant=composer]:min-h-14 data-[variant=composer]:max-h-40 data-[variant=composer]:border-0 data-[variant=composer]:bg-transparent data-[variant=composer]:text-base md:data-[variant=composer]:text-sm data-[variant=composer]:shadow-none data-[variant=composer]:focus-visible:ring-0",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
