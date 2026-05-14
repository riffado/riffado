"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
    const { setTheme, resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    // useEffect+setState on mount is the next-themes-recommended pattern for
    // SSR-safe theme reads. resolvedTheme is undefined on the server and on
    // the first client render, so we paint a neutral placeholder until the
    // store has settled. We can't use useSyncExternalStore here because
    // next-themes doesn't expose its store -- only its hook. The placeholder
    // branch below is the actual flicker-prevention; the lint warning about
    // useEffect-on-mount is pattern-matching the shape, not the intent.
    useEffect(() => {
        setMounted(true);
    }, []);

    // Pre-mount placeholder: keep layout stable, hide icons until we know the
    // real resolvedTheme (avoids a flash of the wrong icon on hydration).
    if (!mounted) {
        return (
            <div
                className={cn(
                    "inline-flex size-9 rounded-full border border-border bg-background/60",
                    className,
                )}
                aria-hidden="true"
            />
        );
    }

    const isDark = resolvedTheme === "dark";
    const nextLabel = isDark ? "Switch to light theme" : "Switch to dark theme";

    return (
        <button
            type="button"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label={nextLabel}
            title={nextLabel}
            className={cn(
                "inline-flex size-9 items-center justify-center rounded-full border border-border bg-background/60 text-muted-foreground hover:text-foreground hover:bg-background hover:border-foreground/20 transition-colors",
                className,
            )}
        >
            {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </button>
    );
}
