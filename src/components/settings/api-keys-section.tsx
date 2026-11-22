"use client";

import { formatDistanceToNow } from "date-fns";
import { Check, Clipboard, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SettingsGroup } from "@/components/settings/section-header";
import { SettingsRowsSkeleton } from "@/components/settings/toggle-row";
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
import { toast } from "@/lib/toast";

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

function formatDate(value: string): string {
    return new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function formatRelative(value: string): string {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
}

/** "read" -> "Read"; several scopes join with "and". */
function formatScopes(scopes: string[]): string {
    if (scopes.length === 0) return "No access";
    const labels = scopes.map((s) => s.charAt(0).toUpperCase() + s.slice(1));
    return labels.join(" and ");
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
            toast.error("Failed to load API keys");
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
                error instanceof Error
                    ? error.message
                    : "Failed to create API key",
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
            toast.success("API key revoked");
            await refreshApiKeys();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to revoke API key",
            );
        }
    };

    const copyCreatedKey = async () => {
        if (!createdKey) return;
        await navigator.clipboard.writeText(createdKey);
        toast.success("API key copied");
    };

    return (
        <SettingsGroup
            title="API keys"
            description="Read access to your recordings for scripts and other apps"
            action={
                <Button
                    variant="ink"
                    size="compact"
                    onClick={() => {
                        setCreatedKey(null);
                        setIsCreateOpen(true);
                    }}
                >
                    <Plus />
                    Create key
                </Button>
            }
        >
            {isLoading ? (
                <SettingsRowsSkeleton rows={2} />
            ) : apiKeys.length === 0 ? (
                <p className="border-y border-hairline py-4 text-ui text-subtle">
                    No keys yet
                </p>
            ) : (
                <ul className="flex flex-col divide-y divide-hairline border-y border-hairline">
                    {apiKeys.map((apiKey) => (
                        <li
                            key={apiKey.id}
                            className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3.5"
                        >
                            <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
                                <span className="truncate text-row font-semibold text-strong">
                                    {apiKey.name}
                                </span>
                                <span className="text-small leading-4 text-subtle">
                                    {formatScopes(apiKey.scopes)} ·{" "}
                                    <span className="font-mono">
                                        {apiKey.keyPrefix}
                                    </span>
                                </span>
                            </div>
                            <div className="flex w-44 shrink-0 flex-col gap-0.5 text-small leading-4 text-subtle">
                                <span>
                                    {apiKey.lastUsedAt
                                        ? `Used ${formatRelative(apiKey.lastUsedAt)}`
                                        : "Never used"}
                                </span>
                                <span>
                                    {apiKey.expiresAt
                                        ? `Expires ${formatDate(apiKey.expiresAt)}`
                                        : `Created ${formatDate(apiKey.createdAt)}`}
                                </span>
                            </div>
                            <div className="ml-auto flex w-20 shrink-0 justify-end">
                                {apiKey.revokedAt ? (
                                    <span className="text-small leading-4 text-subtle">
                                        Revoked
                                    </span>
                                ) : (
                                    <Button
                                        variant="ghost"
                                        size="compact"
                                        onClick={() => handleRevoke(apiKey.id)}
                                        aria-label={`Revoke ${apiKey.name}`}
                                    >
                                        Revoke
                                    </Button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent className="max-w-md">
                    <DialogTitle>Create API Key</DialogTitle>
                    {createdKey ? (
                        <div className="space-y-4">
                            <DialogDescription>
                                This key is shown once.
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
                                    Copy
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
                                    Saved
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="api-key-name">Name</Label>
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
                                    Expiration
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
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={!name.trim() || isCreating}
                                >
                                    Create
                                </Button>
                            </div>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </SettingsGroup>
    );
}
