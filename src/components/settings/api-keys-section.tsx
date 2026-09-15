"use client";

import { Check, Clipboard, KeyRound, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from "@/lib/api-errors";
import { uiText } from "@/lib/i18n";
import { uiError } from "@/lib/i18n/errors";

type ApiKey = {
    id: string;
    name: string;
    keyPrefix: string;
    source: "manual" | "device-flow";
    scopes: string[];
    lastUsedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
    createdAt: string;
};

function formatDate(value: string | null): string {
    if (!value) return uiText("Never");
    return new Date(value).toLocaleString("zh-CN");
}

export function ApiKeysSection() {
    const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [name, setName] = useState("");
    const [expiresAt, setExpiresAt] = useState("");
    const [createdKey, setCreatedKey] = useState<string | null>(null);

    const refreshApiKeys = useCallback(async () => {
        try {
            const response = await fetch("/api/settings/api-keys");
            if (!response.ok) {
                throw new Error(
                    await getApiErrorMessage(
                        response,
                        "Failed to fetch API keys",
                    ),
                );
            }
            const data = (await response.json()) as { apiKeys: ApiKey[] };
            setApiKeys(data.apiKeys);
        } catch {
            toast.error(uiText("Failed to load API keys"));
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshApiKeys();
    }, [refreshApiKeys]);

    const handleCreate = async (event: React.FormEvent) => {
        event.preventDefault();
        setIsCreating(true);

        try {
            const response = await fetch("/api/settings/api-keys", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name,
                    expiresAt: expiresAt
                        ? new Date(expiresAt).toISOString()
                        : null,
                    scopes: ["read"],
                }),
            });

            if (!response.ok) {
                throw new Error(
                    await getApiErrorMessage(
                        response,
                        "Failed to create API key",
                    ),
                );
            }
            const data = (await response.json()) as {
                key?: string;
                apiKey?: ApiKey;
                error?: string;
            };
            if (!data.key || !data.apiKey) {
                throw new Error(data.error || "Failed to create API key");
            }

            setApiKeys((current) => [data.apiKey as ApiKey, ...current]);
            setCreatedKey(data.key);
            setName("");
            setExpiresAt("");
        } catch (error) {
            toast.error(
                uiError(
                    error instanceof Error
                        ? error.message
                        : uiText("Failed to create API key"),
                ),
            );
        } finally {
            setIsCreating(false);
        }
    };

    const handleRevoke = async (apiKeyId: string) => {
        try {
            const response = await fetch(`/api/settings/api-keys/${apiKeyId}`, {
                method: "DELETE",
            });
            if (!response.ok) {
                throw new Error(
                    await getApiErrorMessage(
                        response,
                        "Failed to revoke API key",
                    ),
                );
            }
            toast.success(uiText("API key revoked"));
            await refreshApiKeys();
        } catch (error) {
            toast.error(
                uiError(
                    error instanceof Error
                        ? error.message
                        : uiText("Failed to revoke API key"),
                ),
            );
        }
    };

    const copyCreatedKey = async () => {
        if (!createdKey) return;
        await navigator.clipboard.writeText(createdKey);
        toast.success(uiText("API key copied"));
    };

    return (
        <div className="space-y-6">
            <SettingsSectionHeader
                title={uiText("API Keys")}
                description={uiText(
                    "Personal access tokens for the Riffado public API.",
                )}
                icon={KeyRound}
                action={
                    <Button
                        size="sm"
                        onClick={() => {
                            setCreatedKey(null);
                            setIsCreateOpen(true);
                        }}
                    >
                        <Plus className="size-4" />
                        {uiText("Create Key")}
                    </Button>
                }
            />

            {isLoading ? (
                <div className="flex items-center justify-center py-8">
                    <div className="animate-spin size-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
            ) : apiKeys.length === 0 ? (
                <div className="text-center py-12 border rounded-lg">
                    <KeyRound className="size-12 mx-auto mb-3 text-muted-foreground" />
                    <h3 className="font-semibold mb-2">
                        {uiText("No API keys")}
                    </h3>
                    <Button size="sm" onClick={() => setIsCreateOpen(true)}>
                        <Plus className="size-4" />
                        {uiText("Create Key")}
                    </Button>
                </div>
            ) : (
                <div className="space-y-3">
                    {apiKeys.map((apiKey) => (
                        <div
                            key={apiKey.id}
                            className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                            <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="font-medium">
                                        {apiKey.name}
                                    </h3>
                                    <span className="rounded border px-2 py-0.5 font-mono text-xs text-muted-foreground">
                                        {apiKey.keyPrefix}
                                    </span>
                                    {apiKey.revokedAt && (
                                        <span className="rounded border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                                            {uiText("Revoked")}
                                        </span>
                                    )}
                                </div>
                                <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                                    <span>
                                        {uiText("Last used:")}{" "}
                                        {formatDate(apiKey.lastUsedAt)}
                                    </span>
                                    <span>
                                        {uiText("Expires:")}
                                        {formatDate(apiKey.expiresAt)}
                                    </span>
                                    <span>
                                        {uiText("Created:")}
                                        {formatDate(apiKey.createdAt)}
                                    </span>
                                </div>
                            </div>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => handleRevoke(apiKey.id)}
                                disabled={Boolean(apiKey.revokedAt)}
                                aria-label={uiText("Revoke {name}", {
                                    name: apiKey.name,
                                })}
                            >
                                <Trash2 className="size-4 text-destructive" />
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent className="max-w-md">
                    <DialogTitle>{uiText("Create API Key")}</DialogTitle>
                    {createdKey ? (
                        <div className="space-y-4">
                            <DialogDescription>
                                {uiText("This key is shown once.")}
                            </DialogDescription>
                            <div className="rounded-md border bg-muted p-3 font-mono text-sm break-all">
                                {createdKey}
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="flex-1"
                                    onClick={copyCreatedKey}
                                >
                                    <Clipboard className="size-4" />
                                    {uiText("Copy")}
                                </Button>
                                <Button
                                    type="button"
                                    className="flex-1"
                                    onClick={() => {
                                        setCreatedKey(null);
                                        setIsCreateOpen(false);
                                    }}
                                >
                                    <Check className="size-4" />
                                    {uiText("Saved")}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="api-key-name">
                                    {uiText("Name")}
                                </Label>
                                <Input
                                    id="api-key-name"
                                    value={name}
                                    onChange={(event) =>
                                        setName(event.target.value)
                                    }
                                    placeholder="Hermes Agent"
                                    disabled={isCreating}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="api-key-expires">
                                    {uiText("Expiration")}
                                </Label>
                                <Input
                                    id="api-key-expires"
                                    type="datetime-local"
                                    value={expiresAt}
                                    onChange={(event) =>
                                        setExpiresAt(event.target.value)
                                    }
                                    disabled={isCreating}
                                />
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setIsCreateOpen(false)}
                                    disabled={isCreating}
                                >
                                    {uiText("Cancel")}
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={!name.trim() || isCreating}
                                >
                                    {uiText("Create")}
                                </Button>
                            </div>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
