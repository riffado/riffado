"use client";

import { AppProgressProvider } from "@bprogress/next";
import type { ReactNode } from "react";

export function AppProgress({ children }: { children: ReactNode }) {
    return (
        <AppProgressProvider
            height="3px"
            color="var(--color-primary)"
            options={{ showSpinner: false }}
            shallowRouting
        >
            {children}
        </AppProgressProvider>
    );
}
