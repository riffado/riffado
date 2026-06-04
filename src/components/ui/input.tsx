import type * as React from "react";

import { cn } from "@/lib/utils";

function Input({
    className,
    type,
    ref,
    ...props
}: React.ComponentProps<"input">) {
    return (
        <input
            ref={ref}
            type={type}
            data-slot="input"
            className={cn(
                "file:text-foreground placeholder:text-muted-foreground/60 selection:bg-primary selection:text-primary-foreground",
                "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs",
                "transition-[border-color,box-shadow] duration-150 outline-none",
                "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
                "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40",
                /* dark surface */
                "dark:bg-input/60 dark:border-border dark:text-foreground",
                /* focus */
                "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-0",
                "dark:focus-visible:border-primary dark:focus-visible:ring-primary/20",
                /* validation */
                "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
                className,
            )}
            {...props}
        />
    );
}

export { Input };
