"use client";

import { Toaster as DingToaster } from "@yusufceng1z/ding-react";
import { useTheme } from "next-themes";

/**
 * The one toast region, mounted once in the root layout. Toasts appear at
 * the top centre and follow the app's light or dark theme. Call toasts via
 * `toast` from `@/lib/toast`.
 */
export function Toaster() {
    const { resolvedTheme } = useTheme();
    const theme =
        resolvedTheme === "dark" || resolvedTheme === "light"
            ? resolvedTheme
            : "system";

    return <DingToaster position="top-center" theme={theme} />;
}
