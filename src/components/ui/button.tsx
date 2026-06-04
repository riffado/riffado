import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive cursor-pointer select-none",
    {
        variants: {
            variant: {
                default:
                    "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-[0.98] dark:shadow-none dark:[box-shadow:0_0_0_1px_oklch(0.72_0.19_200_/_0.25),0_4px_12px_oklch(0.72_0.19_200_/_0.25)] dark:hover:[box-shadow:0_0_0_1px_oklch(0.72_0.19_200_/_0.4),0_6px_20px_oklch(0.72_0.19_200_/_0.4)]",
                destructive:
                    "bg-destructive text-white shadow-sm hover:bg-destructive/90 focus-visible:ring-destructive/30 active:scale-[0.98]",
                outline:
                    "border border-border bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground active:scale-[0.98] dark:border-border dark:bg-transparent dark:hover:bg-accent/80 dark:text-foreground",
                secondary:
                    "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80 active:scale-[0.98] dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-accent",
                ghost: "hover:bg-accent hover:text-accent-foreground active:scale-[0.98] dark:hover:bg-accent/80",
                link: "text-primary underline-offset-4 hover:underline",
                glow: "bg-primary text-primary-foreground [box-shadow:0_0_0_1px_oklch(0.72_0.19_200_/_0.3),0_4px_14px_oklch(0.72_0.19_200_/_0.35)] hover:[box-shadow:0_0_0_1px_oklch(0.72_0.19_200_/_0.5),0_6px_20px_oklch(0.72_0.19_200_/_0.5)] active:scale-[0.98] transition-all",
            },
            size: {
                default: "h-9 px-4 py-2 has-[>svg]:px-3",
                sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5 text-xs",
                lg: "h-10 rounded-lg px-6 has-[>svg]:px-4",
                xl: "h-11 rounded-lg px-7 text-base has-[>svg]:px-5",
                icon: "size-9",
                "icon-sm": "size-8",
                "icon-lg": "size-10",
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
