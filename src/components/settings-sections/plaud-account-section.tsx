"use client";

import { format, formatDistanceToNow, isThisYear } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import { PlaudConnectTabs } from "@/components/plaud-connect-tabs";
import { SettingsGroup } from "@/components/settings/section-header";
import { SettingsCard } from "@/components/settings/settings-card";
import { DetailRow } from "@/components/settings/toggle-row";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { StatusDot } from "@/components/ui/status-dot";
import { getApiErrorMessage } from "@/lib/api-errors";
import { plaudConnectionBannerState } from "@/lib/plaud/connection-expiry";
import { PLAUD_SERVERS, type PlaudServerKey } from "@/lib/plaud/servers";
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

/**
 * Short region label for the connection card. Falls back to the raw
 * apiBase for "custom" entries (custom-server users want to see exactly
 * which host they're talking to).
 */
function regionLabel(
    server: PlaudServerKey | undefined,
    apiBase?: string,
): string {
    if (!server) return "Unknown";
    if (server === "custom") return apiBase ?? PLAUD_SERVERS.custom.label;
    if (server === "global") return "Global";
    if (server === "eu") return "EU (Frankfurt)";
    if (server === "apse1") return "Asia Pacific (Singapore)";
    if (server === "cn") return "China Mainland";
    return server;
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

export function PlaudAccountSection({
    onReconnected,
    onDisconnected,
    lastSyncAt = null,
}: PlaudAccountSectionProps = {}) {
    const [info, setInfo] = useState<ConnectionInfo | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [confirmOpen, setConfirmOpen] = useState<
        null | "switch" | "disconnect"
    >(null);
    const [switchDialogOpen, setSwitchDialogOpen] = useState(false);
    const [reconnectDialogOpen, setReconnectDialogOpen] = useState(false);
    const [isMutating, setIsMutating] = useState(false);

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

    const disconnect = useCallback(async (): Promise<boolean> => {
        const res = await fetch("/api/plaud/connection", { method: "DELETE" });
        if (!res.ok) {
            const msg = await getApiErrorMessage(res, "Failed to disconnect");
            throw new Error(msg);
        }
        return true;
    }, []);

    const handleDisconnect = async () => {
        setIsMutating(true);
        try {
            await disconnect();
            toast.success("Plaud account disconnected");
            setConfirmOpen(null);
            onDisconnected?.();
            await fetchConnection();
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Failed to disconnect",
            );
        } finally {
            setIsMutating(false);
        }
    };

    /**
     * Switch flow: explicitly delete the existing connection (and its
     * associated `plaud_devices` rows) before opening the connect dialog.
     * The verify / connect-token routes both upsert, so this isn't strictly
     * required for the connection row, but it prevents stale device rows
     * from the prior account lingering until the next sync rewrites them.
     * Recordings live in a separate table and are unaffected.
     */
    const handleSwitchConfirmed = async () => {
        setIsMutating(true);
        try {
            await disconnect();
            setConfirmOpen(null);
            setSwitchDialogOpen(true);
            // Reflect the unlinked state in the card while the dialog is open
            await fetchConnection();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to unlink current account",
            );
        } finally {
            setIsMutating(false);
        }
    };

    const handleSwitchSuccess = useCallback(async () => {
        setSwitchDialogOpen(false);
        await fetchConnection();
        onReconnected?.();
    }, [fetchConnection, onReconnected]);

    const handleReconnectSuccess = useCallback(async () => {
        setReconnectDialogOpen(false);
        await fetchConnection();
        onReconnected?.();
    }, [fetchConnection, onReconnected]);

    const handleConnectSuccess = useCallback(async () => {
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
    const currentEmailDisplay = currentEmail ?? "the current account";
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
                            {connectionState !== null && (
                                <Button
                                    variant="ink"
                                    size="compact"
                                    onClick={() => setReconnectDialogOpen(true)}
                                >
                                    Reconnect
                                </Button>
                            )}
                            <Button
                                variant="quiet"
                                size="compact"
                                onClick={() => setConfirmOpen("switch")}
                            >
                                Switch account
                            </Button>
                            <Button
                                variant="quiet"
                                size="compact"
                                onClick={() => setConfirmOpen("disconnect")}
                            >
                                Disconnect
                            </Button>
                        </>
                    }
                >
                    <div className="flex flex-col divide-y divide-hairline border-t border-hairline">
                        <DetailRow
                            label="Signed in as"
                            value={
                                currentEmail ?? (
                                    <span className="font-normal text-subtle">
                                        Not known. Switch account to show it
                                    </span>
                                )
                            }
                        />
                        <DetailRow
                            label="Plaud server"
                            value={regionLabel(info.server, info.apiBase)}
                        />
                        {lastSyncAt && (
                            <DetailRow
                                label="Last sync"
                                value={formatDistanceToNow(
                                    new Date(lastSyncAt),
                                    {
                                        addSuffix: true,
                                    },
                                )}
                            />
                        )}
                    </div>
                </SettingsCard>
            ) : (
                <SettingsCard
                    title="Plaud account"
                    description="Not connected. Sign in to start syncing recordings"
                >
                    <PlaudConnectTabs onConnected={handleConnectSuccess} />
                </SettingsCard>
            )}

            {/* Confirm: switch or disconnect */}
            <Dialog
                open={confirmOpen !== null}
                onOpenChange={(open) => {
                    if (!open && !isMutating) setConfirmOpen(null);
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {confirmOpen === "switch"
                                ? "Switch Plaud account?"
                                : "Disconnect Plaud account?"}
                        </DialogTitle>
                        <DialogDescription asChild>
                            <div className="space-y-2 pt-2">
                                {confirmOpen === "switch" ? (
                                    <p>
                                        This will unlink{" "}
                                        <span className="font-mono text-foreground">
                                            {currentEmailDisplay}
                                        </span>{" "}
                                        and let you sign in with a different
                                        Plaud account. Your existing recordings
                                        stay; only future syncs will come from
                                        the new account.
                                    </p>
                                ) : (
                                    <p>
                                        This will unlink{" "}
                                        <span className="font-mono text-foreground">
                                            {currentEmailDisplay}
                                        </span>
                                        . Your existing recordings stay, but
                                        sync will stop until you reconnect.
                                    </p>
                                )}
                            </div>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setConfirmOpen(null)}
                            disabled={isMutating}
                        >
                            Cancel
                        </Button>
                        {confirmOpen === "switch" ? (
                            <Button
                                onClick={handleSwitchConfirmed}
                                disabled={isMutating}
                            >
                                {isMutating ? "Unlinking…" : "Continue"}
                            </Button>
                        ) : (
                            <Button
                                variant="destructive"
                                onClick={handleDisconnect}
                                disabled={isMutating}
                            >
                                {isMutating ? "Disconnecting…" : "Disconnect"}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Switch: connect dialog (full PlaudConnectTabs — connector,
                email-OTP, paste-token) */}
            <Dialog
                open={switchDialogOpen}
                onOpenChange={(open) => setSwitchDialogOpen(open)}
            >
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Sign in to new Plaud account</DialogTitle>
                        <DialogDescription>
                            Choose how you want to connect the Plaud account
                            you’re switching to.
                        </DialogDescription>
                    </DialogHeader>
                    {switchDialogOpen && (
                        <PlaudConnectTabs onConnected={handleSwitchSuccess} />
                    )}
                </DialogContent>
            </Dialog>

            {/* Reconnect: same-account recovery from an invalidated token.
                Unlike "Switch account", this never deletes the existing
                connection/device rows first -- persistPlaudConnection()
                upserts, so re-authenticating with the same (or a new)
                account is safe even if the user backs out of the dialog
                without finishing. */}
            <Dialog
                open={reconnectDialogOpen}
                onOpenChange={(open) => setReconnectDialogOpen(open)}
            >
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Reconnect your Plaud account</DialogTitle>
                        <DialogDescription>
                            Sign back in to resume syncing. Your existing
                            recordings and transcripts are unaffected.
                        </DialogDescription>
                    </DialogHeader>
                    {reconnectDialogOpen && (
                        <PlaudConnectTabs
                            onConnected={handleReconnectSuccess}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </SettingsGroup>
    );
}
