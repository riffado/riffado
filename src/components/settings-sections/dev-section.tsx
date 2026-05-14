"use client";

import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface PlaudInfo {
    connected: boolean;
    reachable?: boolean;
    latencyMs?: number;
    error?: string | null;
    connection?: {
        id: string;
        apiBase: string;
        server: string;
        plaudEmail: string | null;
        createdAt: string;
        updatedAt: string;
    };
    stats?: {
        deviceCount: number | null;
        activeRecordingCount: number | null;
        trashedRecordingCount: number | null;
    };
}

export function DevSection() {
    const [plaudInfo, setPlaudInfo] = useState<PlaudInfo | null>(null);
    const [isLoadingPlaud, setIsLoadingPlaud] = useState(false);

    const fetchPlaudInfo = async () => {
        setIsLoadingPlaud(true);
        try {
            const res = await fetch("/api/dev/plaud/info");
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            const data = (await res.json()) as PlaudInfo;
            setPlaudInfo(data);
            if (data.connected && data.reachable) {
                toast.success(`Plaud reachable (${data.latencyMs}ms)`);
            } else if (data.connected && !data.reachable) {
                toast.error(`Plaud unreachable: ${data.error ?? "unknown"}`);
            } else {
                toast.message("No Plaud connection stored");
            }
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Request failed",
            );
        } finally {
            setIsLoadingPlaud(false);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-red-600 dark:text-red-400">
                    Developer Tools
                </h3>
                <p className="text-sm text-muted-foreground">
                    Dev-only diagnostics. Not visible in production builds.
                </p>
            </div>

            <section className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <h4 className="font-medium">Plaud connection</h4>
                        <p className="text-sm text-muted-foreground">
                            Probe the stored bearer token against the stored API
                            base and report counts.
                        </p>
                    </div>
                    <Button
                        onClick={fetchPlaudInfo}
                        disabled={isLoadingPlaud}
                        size="sm"
                        variant="outline"
                    >
                        {isLoadingPlaud ? (
                            <Loader2 className="size-4 animate-spin" />
                        ) : (
                            <RefreshCw className="size-4" />
                        )}
                        <span className="ml-2">Probe</span>
                    </Button>
                </div>

                {plaudInfo && (
                    <div className="space-y-2 text-sm">
                        {!plaudInfo.connected ? (
                            <p className="text-muted-foreground">
                                No connection stored for this user.
                            </p>
                        ) : (
                            <>
                                <div className="flex items-center gap-2">
                                    {plaudInfo.reachable ? (
                                        <CheckCircle2 className="size-4 text-green-500" />
                                    ) : (
                                        <XCircle className="size-4 text-red-500" />
                                    )}
                                    <span>
                                        {plaudInfo.reachable
                                            ? `Reachable in ${plaudInfo.latencyMs}ms`
                                            : `Unreachable: ${plaudInfo.error ?? "unknown"}`}
                                    </span>
                                </div>
                                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-xs">
                                    <dt className="text-muted-foreground">
                                        server
                                    </dt>
                                    <dd>{plaudInfo.connection?.server}</dd>
                                    <dt className="text-muted-foreground">
                                        apiBase
                                    </dt>
                                    <dd className="break-all">
                                        {plaudInfo.connection?.apiBase}
                                    </dd>
                                    <dt className="text-muted-foreground">
                                        email
                                    </dt>
                                    <dd>
                                        {plaudInfo.connection?.plaudEmail ??
                                            "—"}
                                    </dd>
                                    <dt className="text-muted-foreground">
                                        devices
                                    </dt>
                                    <dd>
                                        {plaudInfo.stats?.deviceCount ?? "—"}
                                    </dd>
                                    <dt className="text-muted-foreground">
                                        recordings (active)
                                    </dt>
                                    <dd>
                                        {plaudInfo.stats
                                            ?.activeRecordingCount ?? "—"}
                                    </dd>
                                    <dt className="text-muted-foreground">
                                        recordings (trash)
                                    </dt>
                                    <dd>
                                        {plaudInfo.stats
                                            ?.trashedRecordingCount ?? "—"}
                                    </dd>
                                    <dt className="text-muted-foreground">
                                        updatedAt
                                    </dt>
                                    <dd>{plaudInfo.connection?.updatedAt}</dd>
                                </dl>
                            </>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
}
