"use client";

import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useState } from "react";
import { SettingsGroup } from "@/components/settings/section-header";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

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
                toast.info("No Plaud connection stored");
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
        <SettingsGroup
            title="Plaud connection"
            description="Probes the stored bearer token against the stored API base and reports counts"
            action={
                <Button
                    onClick={fetchPlaudInfo}
                    disabled={isLoadingPlaud}
                    size="compact"
                    variant="quiet"
                >
                    {isLoadingPlaud ? (
                        <Loader2 className="animate-spin" />
                    ) : (
                        <RefreshCw />
                    )}
                    Probe
                </Button>
            }
        >
            <SettingsCard tone="quiet">
                {!plaudInfo && (
                    <p className="text-ui text-subtle">Not probed yet</p>
                )}
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
                                        <CheckCircle2 className="size-4 text-status-ready" />
                                    ) : (
                                        <XCircle className="size-4 text-terracotta" />
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
            </SettingsCard>
        </SettingsGroup>
    );
}
