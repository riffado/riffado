import type * as React from "react";
import { cn } from "@/lib/utils";

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: "default" | "inset" | "glass";
    ref?: React.Ref<HTMLDivElement>;
}

function Panel({ className, variant = "default", ref, ...props }: PanelProps) {
    return (
        <div
            ref={ref}
            className={cn(
                "rounded-xl p-6",
                variant === "inset" && "bg-muted/60 border border-border/50 dark:bg-muted/30",
                variant === "glass" && "glass-surface",
                variant === "default" && "bg-card border border-border shadow-sm dark:shadow-[0_0_0_1px_var(--border),0_4px_12px_oklch(0_0_0_/_0.5)]",
                className,
            )}
            {...props}
        />
    );
}

export { Panel };
