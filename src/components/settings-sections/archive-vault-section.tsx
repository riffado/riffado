"use client";

import { Archive, Eye, EyeOff, Loader2, Lock, LockOpen } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface VaultStatus {
    hasPinLock: boolean;
}

export function ArchiveVaultSection() {
    const [status, setStatus] = useState<VaultStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // PIN form state
    const [mode, setMode] = useState<"idle" | "set" | "change" | "remove">(
        "idle",
    );
    const [currentPin, setCurrentPin] = useState("");
    const [newPin, setNewPin] = useState("");
    const [confirmPin, setConfirmPin] = useState("");
    const [showPins, setShowPins] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        fetch("/api/archive/vault")
            .then((r) => r.json())
            .then((d) => setStatus({ hasPinLock: d.hasPinLock ?? false }))
            .catch(() => setStatus({ hasPinLock: false }))
            .finally(() => setIsLoading(false));
    }, []);

    const resetForm = () => {
        setMode("idle");
        setCurrentPin("");
        setNewPin("");
        setConfirmPin("");
        setShowPins(false);
    };

    const handleSavePin = async () => {
        if (mode === "set" || mode === "change") {
            if (newPin.length < 4 || newPin.length > 12) {
                toast.error("PIN must be 4–12 characters.");
                return;
            }
            if (newPin !== confirmPin) {
                toast.error("PINs do not match.");
                return;
            }
        }

        setIsSaving(true);
        try {
            const body: Record<string, string> = {};
            if (mode === "set") {
                body.newPin = newPin;
            } else if (mode === "change") {
                body.currentPin = currentPin;
                body.newPin = newPin;
            } else if (mode === "remove") {
                body.currentPin = currentPin;
            }

            const res = await fetch("/api/archive/vault", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(data.error ?? "Failed to update PIN.");
                return;
            }
            toast.success(
                mode === "remove"
                    ? "PIN lock removed."
                    : mode === "set"
                      ? "PIN lock enabled."
                      : "PIN updated.",
            );
            setStatus({ hasPinLock: mode !== "remove" });
            resetForm();
        } catch {
            toast.error("Something went wrong — please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <SettingsSectionHeader
                title="Archive Vault"
                description="Archived recordings are stored here, hidden from the main dashboard. Optionally lock access with a PIN."
            />

            {/* Open Vault */}
            <SettingsCard>
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <Archive className="size-5 text-muted-foreground" />
                        <div>
                            <p className="text-sm font-medium">Archive Vault</p>
                            <p className="text-xs text-muted-foreground">
                                View and manage your archived recordings
                            </p>
                        </div>
                    </div>
                    <Button asChild variant="outline" size="sm">
                        <Link href="/archive">Open Vault</Link>
                    </Button>
                </div>
            </SettingsCard>

            {/* PIN Lock */}
            <SettingsCard>
                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            {isLoading || status?.hasPinLock ? (
                                <Lock className="size-5 text-muted-foreground" />
                            ) : (
                                <LockOpen className="size-5 text-muted-foreground" />
                            )}
                            <div>
                                <p className="text-sm font-medium">PIN Lock</p>
                                <p className="text-xs text-muted-foreground">
                                    {isLoading
                                        ? "Loading…"
                                        : status?.hasPinLock
                                          ? "Vault is PIN-protected"
                                          : "Vault is not locked"}
                                </p>
                            </div>
                        </div>

                        {mode === "idle" && !isLoading && (
                            <div className="flex items-center gap-2">
                                {status?.hasPinLock ? (
                                    <>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => setMode("change")}
                                        >
                                            Change PIN
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => setMode("remove")}
                                        >
                                            Remove PIN
                                        </Button>
                                    </>
                                ) : (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setMode("set")}
                                    >
                                        Set PIN
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* PIN form */}
                    {mode !== "idle" && (
                        <div className="space-y-3 border-t border-border/40 pt-4">
                            <div className="flex items-center justify-between">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    {mode === "set"
                                        ? "Set a new PIN"
                                        : mode === "change"
                                          ? "Change PIN"
                                          : "Remove PIN"}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setShowPins((v) => !v)}
                                    className="text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {showPins ? (
                                        <EyeOff className="size-4" />
                                    ) : (
                                        <Eye className="size-4" />
                                    )}
                                </button>
                            </div>

                            {(mode === "change" || mode === "remove") && (
                                <div className="space-y-1">
                                    <Label className="text-xs">
                                        Current PIN
                                    </Label>
                                    <Input
                                        type={showPins ? "text" : "password"}
                                        value={currentPin}
                                        onChange={(e) =>
                                            setCurrentPin(e.target.value)
                                        }
                                        placeholder="Enter current PIN"
                                        className="h-8 text-sm"
                                        disabled={isSaving}
                                    />
                                </div>
                            )}

                            {(mode === "set" || mode === "change") && (
                                <>
                                    <div className="space-y-1">
                                        <Label className="text-xs">
                                            New PIN{" "}
                                            <span className="text-muted-foreground">
                                                (4–12 characters)
                                            </span>
                                        </Label>
                                        <Input
                                            type={
                                                showPins ? "text" : "password"
                                            }
                                            value={newPin}
                                            onChange={(e) =>
                                                setNewPin(e.target.value)
                                            }
                                            placeholder="New PIN"
                                            className="h-8 text-sm"
                                            disabled={isSaving}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">
                                            Confirm new PIN
                                        </Label>
                                        <Input
                                            type={
                                                showPins ? "text" : "password"
                                            }
                                            value={confirmPin}
                                            onChange={(e) =>
                                                setConfirmPin(e.target.value)
                                            }
                                            placeholder="Confirm PIN"
                                            className="h-8 text-sm"
                                            disabled={isSaving}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter")
                                                    void handleSavePin();
                                            }}
                                        />
                                    </div>
                                </>
                            )}

                            <div className="flex items-center justify-end gap-2 pt-1">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={resetForm}
                                    disabled={isSaving}
                                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={() => void handleSavePin()}
                                    disabled={isSaving}
                                    className="h-7 text-xs"
                                    variant={
                                        mode === "remove"
                                            ? "destructive"
                                            : "default"
                                    }
                                >
                                    {isSaving ? (
                                        <Loader2 className="size-3 animate-spin" />
                                    ) : mode === "remove" ? (
                                        "Remove PIN"
                                    ) : (
                                        "Save PIN"
                                    )}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </SettingsCard>
        </div>
    );
}
