"use client";

import { Bot, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";
import { AddProviderDialog } from "@/components/settings/add-provider-dialog";
import { EditProviderDialog } from "@/components/settings/edit-provider-dialog";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import { PromptManager } from "@/components/settings-sections/prompt-manager";
import { Button } from "@/components/ui/button";

type AISubSection = "providers" | "prompts";

interface Provider {
    id: string;
    provider: string;
    baseUrl: string | null;
    nickname: string | null;
    defaultModel: string | null;
    isDefaultTranscription: boolean;
    isDefaultEnhancement: boolean;
    createdAt: Date;
}

const EMPTY_PROVIDERS: Provider[] = [];

interface ProvidersSectionProps {
    initialProviders?: Provider[];
    isHosted?: boolean;
}

/**
 * AI Providers settings section.
 *
 * Two tabs:
 *  - "Providers": the configured AI providers (transcription / enhancement)
 *    plus the AddProviderDialog and EditProviderDialog. Local state seeded
 *    from `initialProviders` and updated in place by the dialogs.
 *  - "Prompts": delegated entirely to <PromptManager />, which owns its own
 *    settings round-trip + custom prompt CRUD.
 *
 * Note: `initialProviders` is the server-rendered seed only. The local
 * `providers` state diverges from it after add/edit/delete actions; we do
 * NOT re-sync from the prop on changes (would clobber local edits). If the
 * parent ever needs to force a reset, pass a `key` prop instead.
 */
export function ProvidersSection({
    initialProviders = EMPTY_PROVIDERS,
    isHosted = false,
}: ProvidersSectionProps) {
    const confirm = useConfirm();
    const [providers, setProviders] = useState<Provider[]>(initialProviders);
    const [isLoading, setIsLoading] = useState(initialProviders.length === 0);
    const [isAddProviderOpen, setIsAddProviderOpen] = useState(false);
    const [isEditProviderOpen, setIsEditProviderOpen] = useState(false);
    const [editingProvider, setEditingProvider] = useState<Provider | null>(
        null,
    );
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [aiSubSection, setAiSubSection] = useState<AISubSection>("providers");
    const [isScanning, setIsScanning] = useState(false);

    const handleAutoScan = async () => {
        setIsScanning(true);
        try {
            const response = await fetch(
                "/api/settings/ai/providers/auto-scan",
                {
                    method: "POST",
                },
            );
            if (!response.ok) throw new Error("Failed to scan");
            const data = await response.json();
            if (data.provisioned && data.provisioned.length > 0) {
                toast.success(
                    `Discovered and configured: ${data.provisioned.join(", ")}`,
                );
                await refreshProviders();
            } else if (data.found && data.found.length > 0) {
                toast.info(
                    `Found local services (${data.found.join(", ")}), but they were already configured.`,
                );
            } else {
                toast.info(
                    "No local AI services (Whisper, Ollama, Open WebUI) were found.",
                );
            }
        } catch {
            toast.error("An error occurred while scanning for local services.");
        } finally {
            setIsScanning(false);
        }
    };

    const refreshProviders = useCallback(async () => {
        try {
            const response = await fetch("/api/settings/ai/providers");
            if (!response.ok) throw new Error("Failed to fetch");
            const data = await response.json();
            setProviders(data.providers ?? []);
        } catch {
            toast.error("Failed to refresh providers");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshProviders();
    }, [refreshProviders]);

    const handleEdit = (provider: Provider) => {
        setEditingProvider(provider);
        setIsEditProviderOpen(true);
    };

    const handleDelete = (id: string) => {
        void confirm({
            title: "Delete this provider?",
            description:
                "Its API key will be removed from this account. Recordings transcribed or summarized through it keep their data, but you'll need to re-add the provider to use it again.",
            confirmLabel: "Delete",
            pendingLabel: "Deleting…",
            destructive: true,
            onConfirm: async () => {
                setDeletingId(id);
                try {
                    const response = await fetch(
                        `/api/settings/ai/providers/${id}`,
                        { method: "DELETE" },
                    );
                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.error || "Failed to delete");
                    }
                    toast.success("Provider deleted successfully");
                    await refreshProviders();
                } finally {
                    setDeletingId(null);
                }
            },
        });
    };

    return (
        <>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <SettingsSectionHeader
                        title="AI Providers"
                        description="Connect transcription and summary providers. Anything OpenAI-compatible works."
                        icon={Bot}
                    />
                    {aiSubSection === "providers" && (
                        <div className="flex gap-2">
                            {!isHosted && (
                                <Button
                                    onClick={handleAutoScan}
                                    disabled={isScanning}
                                    variant="outline"
                                    size="sm"
                                >
                                    {isScanning ? (
                                        <>
                                            <Loader2 className="size-4 mr-2 animate-spin" />
                                            Scanning…
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="size-4 mr-2" />
                                            Scan for Local Services
                                        </>
                                    )}
                                </Button>
                            )}
                            <Button
                                onClick={() => setIsAddProviderOpen(true)}
                                size="sm"
                            >
                                <Plus className="size-4 mr-2" />
                                Add Provider
                            </Button>
                        </div>
                    )}
                </div>

                {/* Tabs */}
                <div className="flex gap-2 border-b">
                    <button
                        type="button"
                        onClick={() => setAiSubSection("providers")}
                        className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                            aiSubSection === "providers"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        Providers
                    </button>
                    <button
                        type="button"
                        onClick={() => setAiSubSection("prompts")}
                        className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                            aiSubSection === "prompts"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <Sparkles className="size-4 inline mr-2" />
                        Prompts
                    </button>
                </div>

                {aiSubSection === "providers" && isLoading && (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                )}
                {aiSubSection === "providers" && !isLoading && (
                    <ProvidersList
                        providers={providers}
                        deletingId={deletingId}
                        onAdd={() => setIsAddProviderOpen(true)}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                    />
                )}

                {aiSubSection === "prompts" && <PromptManager />}
            </div>

            <AddProviderDialog
                open={isAddProviderOpen}
                onOpenChange={setIsAddProviderOpen}
                isHosted={isHosted}
                onSuccess={() => {
                    setIsAddProviderOpen(false);
                    refreshProviders();
                }}
            />

            <EditProviderDialog
                open={isEditProviderOpen}
                onOpenChange={(open) => {
                    setIsEditProviderOpen(open);
                    if (!open) {
                        setEditingProvider(null);
                    }
                }}
                provider={editingProvider}
                isHosted={isHosted}
                onSuccess={() => {
                    setIsEditProviderOpen(false);
                    setEditingProvider(null);
                    refreshProviders();
                }}
            />
        </>
    );
}

/**
 * Configured-providers list with edit/delete row actions. Pure
 * presentation -- the parent owns the data + dialog state.
 */
function ProvidersList({
    providers,
    deletingId,
    onAdd,
    onEdit,
    onDelete,
}: {
    providers: Provider[];
    deletingId: string | null;
    onAdd: () => void;
    onEdit: (provider: Provider) => void;
    onDelete: (id: string) => void;
}) {
    if (providers.length === 0) {
        return (
            <div className="text-center py-12">
                <Bot className="size-16 mx-auto mb-4 text-muted-foreground" />
                <h3 className="font-semibold mb-2">No providers configured</h3>
                <p className="text-sm text-muted-foreground mb-4">
                    Add an AI provider to enable transcription
                </p>
                <Button onClick={onAdd} size="sm">
                    <Plus className="size-4 mr-2" />
                    Add Provider
                </Button>
            </div>
        );
    }
    return (
        <div className="space-y-3">
            {providers.map((provider) => (
                <div
                    key={provider.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent transition-colors"
                >
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold">
                                {provider.nickname || provider.provider}
                            </h3>
                            {provider.nickname && (
                                <span className="text-xs text-muted-foreground">
                                    {provider.provider}
                                </span>
                            )}
                            {provider.isDefaultTranscription && (
                                <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded border border-primary/20">
                                    Transcription
                                </span>
                            )}
                            {provider.isDefaultEnhancement && (
                                <span className="text-xs px-2 py-0.5 bg-purple-500/10 text-purple-600 rounded border border-purple-500/20">
                                    Enhancement
                                </span>
                            )}
                        </div>
                        {provider.defaultModel && (
                            <p className="text-sm text-muted-foreground">
                                Model: {provider.defaultModel}
                            </p>
                        )}
                        {provider.baseUrl && (
                            <p className="text-xs text-muted-foreground font-mono truncate">
                                {provider.baseUrl}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                        <Button
                            onClick={() => onEdit(provider)}
                            variant="outline"
                            size="icon"
                        >
                            <Pencil className="size-4" />
                        </Button>
                        <Button
                            onClick={() => onDelete(provider.id)}
                            variant="outline"
                            size="icon"
                            disabled={deletingId === provider.id}
                        >
                            {deletingId === provider.id ? (
                                <div className="animate-spin size-4 border-2 border-destructive border-t-transparent rounded-full" />
                            ) : (
                                <Trash2 className="size-4 text-destructive" />
                            )}
                        </Button>
                    </div>
                </div>
            ))}
        </div>
    );
}
