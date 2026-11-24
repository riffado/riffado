"use client";

import { formatDistanceToNow } from "date-fns";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
    type ApiKey,
    ApiKeyDialog,
} from "@/components/settings/api-key-dialog";
import { SettingsGroup } from "@/components/settings/section-header";
import { SettingsRowsSkeleton } from "@/components/settings/toggle-row";
import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/api-errors";
import { toast } from "@/lib/toast";

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
    const [isCreateOpen, setIsCreateOpen] = useState(false);

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

    return (
        <SettingsGroup
            title="API keys"
            description="Read access to your recordings for scripts and other apps"
            action={
                <Button
                    variant="ink"
                    size="compact"
                    onClick={() => setIsCreateOpen(true)}
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

            <ApiKeyDialog
                open={isCreateOpen}
                onOpenChange={setIsCreateOpen}
                onCreated={(apiKey) =>
                    setApiKeys((current) => [apiKey, ...current])
                }
            />
        </SettingsGroup>
    );
}
