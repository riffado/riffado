"use client";

import { CheckCircle2, Link2Off, Mic, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PlaudConnectTabs } from "@/components/plaud-connect-tabs";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { getApiErrorMessage } from "@/lib/api-errors";
import { PLAUD_SERVERS, type PlaudServerKey } from "@/lib/plaud/servers";

interface ConnectionInfo {
    connected: boolean;
    server?: PlaudServerKey;
    plaudEmail?: string | null;
    needsReconnect?: boolean;
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
    return server;
}

interface PlaudAccountSectionProps {
    /**
     * Called after a successful reconnect or account switch, in addition
     * to this component's own `fetchConnection()`. Lets the dashboard
     * (`Workstation`) refresh its server-rendered `plaudNeedsReconnect`
     * prop and kick off a fresh sync -- without it, the dashboard's
     * `PlaudReconnectBanner` can stay stale until the next periodic sync
     * since it's driven by separate client state, not this section's.
     */
    onReconnected?: () => void;
}

export function PlaudAccountSection({
    onReconnected,
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

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="animate-spin size-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
        );
    }

    const currentEmail = info?.plaudEmail ?? null;
    const currentEmailDisplay = currentEmail ?? "the current account";

    return (
        <div className="space-y-6">
            <div>
                <SettingsSectionHeader
                    title="Plaud Account"
                    description="Your connection to the Plaud cloud used to pull recordings."
                    icon={Mic}
                />
                <p className="text-sm text-muted-foreground mt-1">
                    The Plaud account Riffado pulls recordings from. Switching
                    accounts keeps your existing recordings; only future syncs
                    change.
                </p>
            </div>

            {info?.connected ? (
                <Card className="py-4">
                    <CardContent className="space-y-4">
                        <div className="flex items-start gap-3">
                            <CheckCircle2 className="size-5 text-primary mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">
                                    {currentEmail ? (
                                        <span className="font-mono">
                                            {currentEmail}
                                        </span>
                                    ) : (
                                        <span className="text-muted-foreground">
                                            Connected (email unknown)
                                        </span>
                                    )}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    Region:{" "}
                                    {regionLabel(info.server, info.apiBase)}
                                    {!currentEmail && (
                                        <>
                                            {" · "}
                                            <span>
                                                Use “Switch account” below to
                                                display the email
                                            </span>
                                        </>
                                    )}
                                </p>
                            </div>
                        </div>

                        {info.needsReconnect && (
                            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-500">
                                Plaud stopped accepting this sign-in, so syncing
                                is paused. Reconnect to resume — your recordings
                                stay put.
                            </p>
                        )}

                        <div className="flex flex-wrap gap-2">
                            {info.needsReconnect && (
                                <Button
                                    onClick={() => setReconnectDialogOpen(true)}
                                >
                                    <RefreshCw className="size-4 mr-2" />
                                    Reconnect
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                onClick={() => setConfirmOpen("switch")}
                            >
                                <RefreshCw className="size-4 mr-2" />
                                Switch account
                            </Button>
                            <Button
                                variant="ghost"
                                onClick={() => setConfirmOpen("disconnect")}
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                                <Link2Off className="size-4 mr-2" />
                                Disconnect
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <Card className="py-4">
                    <CardContent className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            No Plaud account connected. Sign in below to start
                            syncing recordings.
                        </p>
                        <PlaudConnectTabs
                            onConnected={() => fetchConnection()}
                            variant="dialog"
                        />
                    </CardContent>
                </Card>
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
                        <PlaudConnectTabs
                            onConnected={handleSwitchSuccess}
                            variant="dialog"
                        />
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
                            variant="dialog"
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
