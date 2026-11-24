import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const sizeClass = {
    default: "h-6 min-w-6 px-[7px]",
    small: "h-5.5 min-w-5.5 px-1.5",
} as const;

/**
 * A key on the keyboard (System 05 "Keycaps"): Sand fill, no border,
 * medium 12px label. `default` (24px) sits in the shortcuts sheet;
 * `small` (22px) in the command palette's rows and footer.
 */
export function Keycap({
    size = "default",
    className,
    children,
}: {
    size?: keyof typeof sizeClass;
    className?: string;
    children: ReactNode;
}) {
    return (
        <kbd
            className={cn(
                "squircle inline-flex shrink-0 items-center justify-center rounded-[7px] bg-menu-highlight font-sans text-xs font-medium text-subtle select-none [&_svg]:size-3",
                sizeClass[size],
                className,
            )}
        >
            {children}
        </kbd>
    );
}
