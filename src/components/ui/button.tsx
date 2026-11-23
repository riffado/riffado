import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * On touch screens, grows the hit area to at least 44x44 around a
 * compact control without changing how it looks. The host must be
 * positioned (`relative`).
 */
export const touchTargetClass =
    "pointer-coarse:after:absolute pointer-coarse:after:top-1/2 pointer-coarse:after:left-1/2 pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 pointer-coarse:after:-translate-1/2";

const inkVariant =
    "bg-ink text-background hover:bg-ink/90 dark:bg-foreground dark:hover:bg-foreground/90";

const buttonVariants = cva(
    [
        "motion-press relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        touchTargetClass,
    ],
    {
        variants: {
            variant: {
                /** Primary actions are ink (DESIGN.md). */
                default: inkVariant,
                /** Terracotta fill. Opt-in: the accent is spent once per screen. */
                primary:
                    "bg-primary text-primary-foreground hover:bg-primary/90",
                destructive:
                    "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
                outline:
                    "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
                secondary:
                    "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
                link: "text-primary underline-offset-4 hover:underline active:scale-100",
                ink: inkVariant,
                quiet: "border border-border bg-card text-card-foreground hover:bg-secondary",
                /** Hairline outline on whatever surface it sits on (dialog Cancel). */
                bordered:
                    "border border-border bg-transparent text-strong hover:bg-accent",
            },
            size: {
                default: "h-9 px-4 py-2 has-[>svg]:px-3",
                sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
                lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
                icon: "size-9",
                "icon-sm": "size-8",
                "icon-lg": "size-10",
                "icon-compact": "squircle size-7 rounded-[var(--radius-small)]",
                compact:
                    "squircle h-8 rounded-[var(--radius-inner)] px-3 text-small font-medium has-[>svg]:px-2.5",
                control:
                    "squircle h-11 rounded-[var(--radius-control)] px-4 text-[15px] font-semibold",
                /** 40px dialog button (confirm dialog footer). */
                dialog: "squircle h-10 rounded-[var(--radius-inner)] px-4 text-ui font-medium",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    },
);

function Button({
    className,
    variant,
    size,
    asChild = false,
    ...props
}: React.ComponentProps<"button"> &
    VariantProps<typeof buttonVariants> & {
        asChild?: boolean;
    }) {
    const Comp = asChild ? Slot : "button";

    return (
        <Comp
            data-slot="button"
            className={cn(buttonVariants({ variant, size, className }))}
            {...props}
        />
    );
}

export { Button, buttonVariants };
