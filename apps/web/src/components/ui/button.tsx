import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Belay: four variants from the charter. Every target is at least 44 px; a disabled button reads
// as track fill and muted text instead of fading, so its label stays legible. A busy button hides
// its leading icon behind the loading arc (aria-busy) and keeps its label and width.
const buttonBox = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1.5 border border-transparent bg-clip-padding whitespace-nowrap press outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:text-muted-foreground aria-busy:[&_svg]:hidden [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Belay: hover on the ink shade, not primary/80: white on a faded orange fell to 3.8:1.
        primary:
          "h-12.5 rounded-field bg-primary px-4 text-primary-foreground hover:bg-primary-ink disabled:bg-track",
        secondary:
          "h-11 rounded-control bg-track px-3 text-foreground disabled:bg-track",
        // The pressed tint is instant: only transform animates, through the shared press.
        text: "h-11 rounded-control px-3 text-primary active:bg-press-tint active:text-primary-ink disabled:bg-transparent dark:text-primary-ink",
        destructive:
          "h-11 rounded-control px-3 text-destructive active:bg-press-tint disabled:bg-transparent",
      },
      size: {
        default: "",
        icon: "size-11 px-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

// The charter's type steps, kept out of the class merge: it reads text-button or text-body as a
// colour and would drop it against the variant's text colour.
const TYPE = {
  primary: "text-button",
  secondary: "text-body font-semibold",
  text: "text-body font-semibold",
  destructive: "text-body font-semibold",
} as const

function buttonVariants({
  variant,
  size,
  className,
}: VariantProps<typeof buttonBox> & { className?: string } = {}) {
  return `${cn(buttonBox({ variant, size, className }))} ${TYPE[variant ?? "primary"]}`
}

function Button({
  className,
  variant = "primary",
  size = "default",
  asChild = false,
  busy = false,
  onClick,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonBox> & {
    asChild?: boolean
    busy?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      aria-busy={busy || undefined}
      className={buttonVariants({ variant, size, className })}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        // Ruling 10: a second tap while the first is still saving does nothing.
        if (busy) {
          event.preventDefault()
          return
        }
        onClick?.(event)
      }}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {busy && (
            <span
              aria-hidden="true"
              className="size-4.5 shrink-0 animate-spin-arc rounded-round border-2 border-current border-t-transparent"
            />
          )}
          {children}
        </>
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
