"use client";

import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PlaudHealthStatus } from "@/hooks/use-plaud-health";
import { cn } from "@/lib/utils";

interface PlaudHealthBannerProps {
    status: PlaudHealthStatus;
    onRetry: () => void;
}

/**
 * Sticky top-right warning banner shown when the Plaud token has expired
 * and there is no Connector extension available to auto-resync.
 *
 * Dismissed per-session (state is local so it re-appears on reload if the
 * issue persists).
 */
export function PlaudHealthBanner({ status, onRetry }: PlaudHealthBannerProps) {
    const [dismissed, setDismissed] = useState(false);

    const shouldShow =
        !dismissed &&
        (status === "token_invalid" || status === "network_error");

    if (!shouldShow) return null;

    const isNetworkError = status === "network_error";

    return (
        <div
            className={cn(
                "fixed top-4 right-4 z-50 w-80 rounded-xl border shadow-xl",
                "animate-in slide-in-from-top-2 fade-in duration-300",
                "bg-card/95 backdrop-blur-sm",
                isNetworkError ? "border-amber-500/40" : "border-red-500/40",
            )}
        >
            <div className="p-4">
                <div className="flex items-start gap-3">
                    <div
                        className={cn(
                            "mt-0.5 rounded-full p-1.5 shrink-0",
                            isNetworkError
                                ? "bg-amber-500/15 text-amber-500"
                                : "bg-red-500/15 text-red-500",
                        )}
                    >
                        <AlertTriangle className="size-3.5" />
                    </div>

                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold leading-snug">
                            {isNetworkError
                                ? "Plaud unreachable"
                                : "Plaud session expired"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                            {isNetworkError
                                ? "Could not reach Plaud's servers. Check your connection."
                                : "Your Plaud token has expired. Install the Mesynx AI Connector extension to auto-refresh, or reconnect manually."}
                        </p>

                        <div className="mt-3 flex items-center gap-2">
                            {!isNetworkError && (
                                <Button
                                    size="sm"
                                    variant="default"
                                    asChild
                                    className="h-7 text-xs px-3"
                                >
                                    <a href="/settings?tab=plaud">Reconnect</a>
                                </Button>
                            )}
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={onRetry}
                                className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground gap-1"
                            >
                                <RefreshCw className="size-3" />
                                Retry
                            </Button>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => setDismissed(true)}
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                        aria-label="Dismiss"
                    >
                        <X className="size-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
