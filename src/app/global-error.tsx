"use client";

import posthog from "posthog-js";
import { useEffect } from "react";
import { uiText } from "@/lib/i18n";

/**
 * Root-layout-level error boundary -- catches errors that occur in
 * `layout.tsx` itself, where the regular `error.tsx` boundary can't help
 * because it renders inside the layout it would need to replace. Must
 * render its own <html>/<body>; Next.js swaps the whole document in.
 */
export default function GlobalError({
    error,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        if (posthog.__loaded) {
            posthog.captureException(error);
        }
    }, [error]);

    return (
        <html lang="zh-CN">
            <body>
                <div
                    style={{
                        display: "flex",
                        minHeight: "100vh",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "1rem",
                        padding: "1rem",
                        textAlign: "center",
                        fontFamily: "system-ui, sans-serif",
                    }}
                >
                    <h2>{uiText("Something went wrong")}</h2>
                    <p>{uiText("Please reload the page.")}</p>
                </div>
            </body>
        </html>
    );
}
