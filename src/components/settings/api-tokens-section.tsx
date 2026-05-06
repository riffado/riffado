"use client";

import { Check, Clipboard, KeyRound, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ApiToken = {
    id: string;
    name: string;
    tokenPrefix: string;
    scopes: string[];
    lastUsedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
    createdAt: string;
};

function formatDate(value: string | null): string {
    if (!value) return "Never";
    return new Date(value).toLocaleString();
}

export function ApiTokensSection() {
    const [tokens, setTokens] = useState<ApiToken[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [name, setName] = useState("");
    const [expiresAt, setExpiresAt] = useState("");
    const [createdToken, setCreatedToken] = useState<string | null>(null);

    const refreshTokens = useCallback(async () => {
        try {
            const response = await fetch("/api/settings/tokens");
            if (!response.ok) throw new Error("Failed to fetch tokens");
            const data = (await response.json()) as { tokens: ApiToken[] };
            setTokens(data.tokens);
        } catch {
            toast.error("Failed to load API tokens");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshTokens();
    }, [refreshTokens]);

    const handleCreate = async (event: React.FormEvent) => {
        event.preventDefault();
        setIsCreating(true);

        try {
            const response = await fetch("/api/settings/tokens", {
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

            const data = (await response.json()) as {
                token?: string;
                accessToken?: ApiToken;
                error?: string;
            };
            if (!response.ok || !data.token || !data.accessToken) {
                throw new Error(data.error || "Failed to create token");
            }

            const accessToken = data.accessToken;
            setTokens((current) => [accessToken, ...current]);
            setCreatedToken(data.token);
            setName("");
            setExpiresAt("");
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to create token",
            );
        } finally {
            setIsCreating(false);
        }
    };

    const handleRevoke = async (tokenId: string) => {
        try {
            const response = await fetch(`/api/settings/tokens/${tokenId}`, {
                method: "DELETE",
            });
            if (!response.ok) throw new Error("Failed to revoke token");
            toast.success("API token revoked");
            await refreshTokens();
        } catch {
            toast.error("Failed to revoke API token");
        }
    };

    const copyCreatedToken = async () => {
        if (!createdToken) return;
        await navigator.clipboard.writeText(createdToken);
        toast.success("Token copied");
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <KeyRound className="w-5 h-5" />
                    API Tokens
                </h2>
                <Button
                    size="sm"
                    onClick={() => {
                        setCreatedToken(null);
                        setIsCreateOpen(true);
                    }}
                >
                    <Plus className="w-4 h-4" />
                    Create Token
                </Button>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-8">
                    <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
            ) : tokens.length === 0 ? (
                <div className="text-center py-12 border rounded-lg">
                    <KeyRound className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                    <h3 className="font-semibold mb-2">No API tokens</h3>
                    <Button size="sm" onClick={() => setIsCreateOpen(true)}>
                        <Plus className="w-4 h-4" />
                        Create Token
                    </Button>
                </div>
            ) : (
                <div className="space-y-3">
                    {tokens.map((token) => (
                        <div
                            key={token.id}
                            className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                            <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="font-medium">
                                        {token.name}
                                    </h3>
                                    <span className="rounded border px-2 py-0.5 font-mono text-xs text-muted-foreground">
                                        {token.tokenPrefix}
                                    </span>
                                    {token.revokedAt && (
                                        <span className="rounded border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                                            Revoked
                                        </span>
                                    )}
                                </div>
                                <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                                    <span>
                                        Last used:{" "}
                                        {formatDate(token.lastUsedAt)}
                                    </span>
                                    <span>
                                        Expires: {formatDate(token.expiresAt)}
                                    </span>
                                    <span>
                                        Created: {formatDate(token.createdAt)}
                                    </span>
                                </div>
                            </div>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => handleRevoke(token.id)}
                                disabled={Boolean(token.revokedAt)}
                                aria-label={`Revoke ${token.name}`}
                            >
                                <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent className="max-w-md">
                    <DialogTitle>Create API Token</DialogTitle>
                    {createdToken ? (
                        <div className="space-y-4">
                            <DialogDescription>
                                This token is shown once.
                            </DialogDescription>
                            <div className="rounded-md border bg-muted p-3 font-mono text-sm break-all">
                                {createdToken}
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="flex-1"
                                    onClick={copyCreatedToken}
                                >
                                    <Clipboard className="w-4 h-4" />
                                    Copy
                                </Button>
                                <Button
                                    type="button"
                                    className="flex-1"
                                    onClick={() => {
                                        setCreatedToken(null);
                                        setIsCreateOpen(false);
                                    }}
                                >
                                    <Check className="w-4 h-4" />
                                    Saved
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="token-name">Name</Label>
                                <Input
                                    id="token-name"
                                    value={name}
                                    onChange={(event) =>
                                        setName(event.target.value)
                                    }
                                    placeholder="Hermes Agent"
                                    disabled={isCreating}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="token-expires">
                                    Expiration
                                </Label>
                                <Input
                                    id="token-expires"
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
        </div>
    );
}
