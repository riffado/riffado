import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import { baseOptions, docsTabs } from "@/app/layout.config";
import { source } from "@/lib/source";
import "fumadocs-ui/style.css";
import "./docs.css";

export default function DocsRootLayout({ children }: { children: ReactNode }) {
    // theme.enabled: false so Fumadocs doesn't double-mount next-themes.
    return (
        <RootProvider theme={{ enabled: false }}>
            <DocsLayout tree={source.pageTree} tabs={docsTabs} {...baseOptions}>
                {children}
            </DocsLayout>
        </RootProvider>
    );
}
