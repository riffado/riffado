"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Progress({
    className,
    value,
    ref,
    ...props
}: React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    ref?: React.Ref<React.ComponentRef<typeof ProgressPrimitive.Root>>;
}) {
    return (
        <ProgressPrimitive.Root
            ref={ref}
            className={cn(
                "relative h-1.5 w-full overflow-hidden rounded-full bg-muted dark:bg-muted/40",
                className,
            )}
            {...props}
        >
            <ProgressPrimitive.Indicator
                className="h-full w-full flex-1 bg-primary transition-all duration-300 ease-out"
                style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
            />
        </ProgressPrimitive.Root>
    );
}

export { Progress };
