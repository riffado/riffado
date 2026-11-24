"use client";

import { format, formatDistanceToNow, isThisYear } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import {
    PlaudConnectDialog,
    type PlaudConnectIntent,
    type PlaudConnectView,
} from "@/components/plaud-connect/connect-dialog";
import { plaudServerName } from "@/components/plaud-connect/server-label";
import { SettingsGroup } from "@/components/settings/section-header";
import { SettingsCard } from "@/components/settings/settings-card";
import { DetailRow } from "@/components/settings/toggle-row";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { getApiErrorMessage } from "@/lib/api-errors";
import { plaudConnectionBannerState } from "@/lib/plaud/connection-expiry";
import type { PlaudServerKey } from "@/lib/plaud/servers";
import { toast } from "@/lib/toast";

interface ConnectionInfo {
    connected: boolean;
    server?: PlaudServerKey;
    plaudEmail?: string | null;
    needsReconnect?: boolean;
    accessExpiresAt?: string | null;
    sessionExpiresAt?: string | null;
    autoRenews?: boolean;
    createdAt?: string;
    updatedAt?: string;
    apiBase?: string;
}

function formatEndDate(iso: string): string {
    const date = new Date(iso);
    return format(date, isThisYear(date) ? "MMM d" : "MMM d, yyyy");
}

interface PlaudAccountSectionProps {
    /**
     * Called after a successful first connect, reconnect or account
     * switch, in addition to this component's own `fetchConnection()`.
     * The settings page uses it to refresh server data (so the Library
     * shows the new connection) and start a sync.
     */
    onReconnected?: () => void;
    /**
     * Called after the user disconnects Plaud, so server-rendered views
     * drop the connection without a reload.
     */
    onDisconnected?: () => void;
    /**
     * When the server last recorded a successful sync (ISO string), or
     * null when never or unknown. Shown as "Last sync".
     */
    lastSyncAt?: string | null;
}

/**
 * Settings > Recorders > Sources: the Plaud account card. Connect,
 * reconnect and switch all open the one Connect Plaud dialog.
 */
export function PlaudAccountSection({
    onReconnected,
    onDisconnected,
    lastSyncAt = null,
}: PlaudAccountSectionProps = {}) {
    const confirm = useConfirm();
    const [info, setInfo] = useState<ConnectionInfo | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogMode, setDialogMode] = useState<{
        intent: PlaudConnectIntent;
        view: PlaudConnectView;
    }>({ intent: "connect", view: "main" });
    const openDialog = (intent: PlaudConnectIntent, view: PlaudConnectView) => {
        setDialogMode({ intent, view });
        setDialogOpen(true);
    };

    const fetchConnection = useCallback(async () => {
        try {
            const res = await fetch("/api/plaud/connection");
            if (!res.ok) {
                throw new Error(
                    await getApiErrorMessage(res, "Failed to load connection"),
                );
            }
            const data: ConnectionInfo = await res.json();
            setInfo(data);
        } catch (error) {
            console.error("Failed to load Plaud connection:", error);
            setInfo({ connected: false });
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchConnection();
    }, [fetchConnection]);

    const disconnect = useCallback(async () => {
        const res = await fetch("/api/plaud/connection", { method: "DELETE" });
        if (!res.ok) {
            throw new Error(
                await getApiErrorMessage(res, "Failed to disconnect"),
            );
        }
    }, []);

    const handleConnected = useCallback(async () => {
        setDialogOpen(false);
        await fetchConnection();
        onReconnected?.();
    }, [fetchConnection, onReconnected]);

    if (isLoading) {
        return (
            <SettingsGroup
                title="Sources"
                description="New recordings reach Riffado from here"
            >
                <div
                    className="squircle h-52 animate-pulse rounded-[var(--radius-card)] border border-border bg-surface"
                    aria-busy="true"
                >
                    <span className="sr-only">Loading Plaud connection</span>
                </div>
            </SettingsGroup>
        );
    }

    const currentEmail = info?.plaudEmail ?? null;
    const accountName = currentEmail ? (
        <span className="font-medium text-strong">{currentEmail}</span>
    ) : (
        "the current Plaud account"
    );

    const askDisconnect = () =>
        confirm({
            title: "Disconnect Plaud account?",
            description: (
                <p>
                    Riffado stops syncing from {accountName}. Recordings you
                    already have stay here.
                </p>
            ),
            confirmLabel: "Disconnect",
            pendingLabel: "Disconnecting…",
            destructive: true,
            onConfirm: async () => {
                await disconnect();
                toast.success("Plaud account disconnected");
                onDisconnected?.();
                await fetchConnection();
            },
        });

    /*
     * Switch deletes the connection and its device rows before the new
     * sign-in, so the old account's recorders don't linger until the next
     * sync. Recordings live in their own table and stay.
     */
    const askSwitch = async () => {
        const confirmed = await confirm({
            title: "Switch Plaud account?",
            description: (
                <p>
                    Riffado unlinks {accountName} so you can sign in to a
                    different Plaud account. Recordings you already have stay
                    here; new ones come from the new account.
                </p>
            ),
            confirmLabel: "Switch account",
            pendingLabel: "Unlinking…",
            errorMessage: "Couldn't unlink the current account",
            onConfirm: disconnect,
        });
        if (!confirmed) return;
        openDialog("switch", "main");
        await fetchConnection();
    };

    const connectionState = info?.connected
        ? plaudConnectionBannerState({
              needsReconnect: info.needsReconnect === true,
              sessionExpiresAt: info.sessionExpiresAt,
              now: Date.now(),
          })
        : null;
    const sessionEndsOn = info?.sessionExpiresAt
        ? formatEndDate(info.sessionExpiresAt)
        : null;

    let status: { tone: "ready" | "working" | "attention"; text: string };
    if (connectionState === "reconnect") {
        status = {
            tone: "attention",
            text: "Plaud stopped accepting this sign-in, so syncing is paused. Reconnect to resume. Your recordings stay put.",
        };
    } else if (connectionState === "ending-soon") {
        status = {
            tone: "working",
            text: `Your Plaud connection ends on ${sessionEndsOn}. Reconnect to keep syncing.`,
        };
    } else if (sessionEndsOn) {
        status = {
            tone: "ready",
            text: `Connected until ${sessionEndsOn}. You'll sign in again after that.`,
        };
    } else {
        status = { tone: "ready", text: "Connected" };
    }

    return (
        <SettingsGroup
            title="Sources"
            description="New recordings reach Riffado from here"
        >
            {info?.connected ? (
                <SettingsCard
                    className="pb-2"
                    title="Plaud account"
                    description={
                        <span className="flex items-start gap-2">
                            <StatusDot tone={status.tone} className="mt-1.5" />
                            <span>{status.text}</span>
                        </span>
                    }
                    action={
                        <>
                            <Button
                                variant={
                                    connectionState === null ? "quiet" : "ink"
                                }
                                size="compact"
                                onClick={() => openDialog("reconnect", "main")}
                            >
                                Reconnect
                            </Button>
                            <Button
                                variant="quiet"
                                size="compact"
                                onClick={askDisconnect}
                            >
                                Disconnect
                            </Button>
                        </>
                    }
                >
                    <div className="flex flex-col divide-y divide-hairline border-t border-hairline">
                        <div className="flex items-center justify-between gap-4 py-1.25 text-ui">
                            <span className="shrink-0 text-subtle">
                                Signed in as
                            </span>
                            <span className="flex min-w-0 items-center gap-1">
                                <span className="min-w-0 truncate font-medium text-strong">
                                    {currentEmail ?? (
                                        <span className="font-normal text-subtle">
                                            Not known
                                        </span>
                                    )}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="compact"
                                    onClick={() => void askSwitch()}
                                    className="-mr-3 shrink-0 text-subtle hover:text-strong"
                                >
                                    Switch account
                                </Button>
                            </span>
                        </div>
                        <DetailRow
                            label="Plaud server"
                            value={plaudServerName(info.server, info.apiBase)}
                        />
                        {lastSyncAt && (
                            <DetailRow
                                label="Last sync"
                                value={formatDistanceToNow(
                                    new Date(lastSyncAt),
                                    { addSuffix: true },
                                )}
                            />
                        )}
                    </div>
                </SettingsCard>
            ) : (
                <SettingsCard
                    title="Plaud account"
                    description="Not connected. Sign in to start syncing recordings"
                    action={
                        <>
                            <Button
                                variant="ink"
                                size="compact"
                                onClick={() => openDialog("connect", "main")}
                            >
                                Sign in with Plaud
                            </Button>
                            <Button
                                variant="quiet"
                                size="compact"
                                onClick={() => openDialog("connect", "email")}
                            >
                                Other ways to connect
                            </Button>
                        </>
                    }
                />
            )}

            {/* Reconnect never deletes the connection first: the connect
                routes upsert, so backing out of the dialog leaves the
                current sign-in as it was. */}
            <PlaudConnectDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                intent={dialogMode.intent}
                initialView={dialogMode.view}
                account={
                    info?.connected
                        ? {
                              email: currentEmail,
                              server: info.server,
                              apiBase: info.apiBase,
                          }
                        : null
                }
                reason={
                    connectionState === "reconnect"
                        ? "signed-out"
                        : connectionState === "ending-soon"
                          ? "ending-soon"
                          : null
                }
                endsOn={sessionEndsOn}
                onConnected={() => void handleConnected()}
            />
        </SettingsGroup>
    );
}
