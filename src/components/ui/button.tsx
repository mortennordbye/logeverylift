import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // `active:scale-[0.97]` is the tap feedback. This is a touch-first PWA, so
  // the hover styles on each variant below never fire on the device the app is
  // actually used on — without an :active state these buttons had no press
  // feedback at all. The feature components hand-roll their own `active:`;
  // this covers the admin screens and ThemeToggle, which use shadcn directly.
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none active:scale-[0.97] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 active:bg-destructive/80 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground active:bg-accent dark:border-input dark:bg-input/30 dark:hover:bg-input/50 dark:active:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70",
        ghost:
          "hover:bg-accent hover:text-accent-foreground active:bg-accent dark:hover:bg-accent/50 dark:active:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline active:opacity-70",
      },
      size: {
        // Every size below 44px carries `tap-44` (globals.css): the visual box
        // is unchanged, an invisible pseudo-element extends the touch target
        // to the project's 44x44 minimum. Growing the boxes themselves would
        // reflow every toolbar that uses them.
        default: "h-9 px-4 py-2 has-[>svg]:px-3 tap-44",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3 tap-44",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5 tap-44",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4 tap-44",
        icon: "size-9 tap-44",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3 tap-44",
        "icon-sm": "size-8 tap-44",
        "icon-lg": "size-10 tap-44",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
