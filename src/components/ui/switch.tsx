"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Switch({
    className,
    ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
    return (
        <SwitchPrimitive.Root
            data-slot="switch"
            className={cn(
                "peer inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs outline-none transition-all duration-200",
                "data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
                "dark:data-[state=unchecked]:bg-muted/60 dark:data-[state=checked]:[box-shadow:0_0_8px_oklch(0.72_0.19_200_/_0.3)]",
                "focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                "disabled:cursor-not-allowed disabled:opacity-40",
                className,
            )}
            {...props}
        >
            <SwitchPrimitive.Thumb
                data-slot="switch-thumb"
                className="bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform duration-200 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
            />
        </SwitchPrimitive.Root>
    );
}

export { Switch };
