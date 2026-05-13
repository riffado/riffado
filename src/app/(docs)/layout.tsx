import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import { baseOptions, docsTabs } from "@/app/layout.config";
import { source } from "@/lib/source";
import "fumadocs-ui/style.css";
import "./docs.css";

// Docs route group. Renders unconditionally in both self-host and hosted
// modes \u2014 self-hosters need offline access to operator docs, hosted users
// need them too. No `IS_HOSTED` gate here on purpose.
//
// `RootProvider` is Fumadocs-specific and lives inside this segment instead
// of the app-wide root layout so the rest of the app (dashboard, recordings,
// settings) doesn't pay for its context providers.
export default function DocsRootLayout({ children }: { children: ReactNode }) {
    // `theme={{ enabled: false }}` disables Fumadocs' bundled `next-themes`
    // provider so we don't double-mount one (the app root already wraps the
    // tree in `<ThemeProvider>` via `src/components/theme-provider.tsx`).
    // The app-wide toggle continues to flip `.dark` on `<html>`, and the
    // docs.css remap reacts to it the same as every other surface.
    return (
        <RootProvider theme={{ enabled: false }}>
            <DocsLayout tree={source.pageTree} tabs={docsTabs} {...baseOptions}>
                {children}
            </DocsLayout>
        </RootProvider>
    );
}
