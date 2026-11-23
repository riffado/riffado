"use client";

import { Info, KeyRound, Monitor, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { AddProviderDialog } from "@/components/settings/add-provider-dialog";
import { EditProviderDialog } from "@/components/settings/edit-provider-dialog";
import { OptionCard, OptionCardGroup } from "@/components/settings/option-card";
import {
    credentialsInOrder,
    fetchProviders,
    isLocalProvider,
    providerSummaryLine,
    saveDefaultSummaries,
} from "@/components/settings/provider-actions";
import { SettingsGroup } from "@/components/settings/section-header";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { supportsEnhancement } from "@/lib/ai/provider-presets";
import { toast } from "@/lib/toast";

/** A row in the AI Providers list, as returned by `/api/settings/ai/providers`. */
export interface Provider {
    id: string;
    provider: string;
    baseUrl: string | null;
    defaultModel: string | null;
    isDefaultTranscription: boolean;
    isDefaultEnhancement: boolean;
    createdAt: Date;
    managed?: boolean;
    includedSeconds?: number;
    available?: boolean;
}

interface ProvidersSectionProps {
    /** The provider list, or null while it is still loading. */
    providers: Provider[] | null;
    /** Receives the list re-read from the server after an add, edit, delete or default change. */
    onProvidersChange: (providers: Provider[]) => void;
    /** True when the list could not be loaded; shows an error with `onRetry`. */
    loadFailed?: boolean;
    /** Retries loading the list after `loadFailed`. */
    onRetry?: () => void;
    isHosted?: boolean;
}

/**
 * The provider that actually writes summaries and titles, matching
 * `generate-summary`: the flagged enhancement default if it can chat,
 * otherwise the oldest provider that can.
 */
function summariesProviderId(providers: Provider[]): string | undefined {
    const capable = credentialsInOrder(providers).filter((p) =>
        supportsEnhancement(p.provider),
    );
    return (capable.find((p) => p.isDefaultEnhancement) ?? capable[0])?.id;
}

/**
 * The user's own AI providers: one list shared by transcription and
 * summaries. Each provider is an option card; the selected one writes
 * summaries and titles. Adding, editing and deleting happen here; the
 * transcription choice lives on the Transcription page.
 *
 * Mynah (the managed provider) is transcription only and never appears
 * here.
 */
export function ProvidersSection({
    providers,
    onProvidersChange,
    loadFailed = false,
    onRetry,
    isHosted = false,
}: ProvidersSectionProps) {
    const confirm = useConfirm();
    const [isAddProviderOpen, setIsAddProviderOpen] = useState(false);
    const [isEditProviderOpen, setIsEditProviderOpen] = useState(false);
    const [editingProvider, setEditingProvider] = useState<Provider | null>(
        null,
    );
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const refreshProviders = async () => {
        try {
            onProvidersChange(await fetchProviders());
        } catch {
            toast.error("Failed to refresh providers");
        }
    };

    const handleEdit = (provider: Provider) => {
        setEditingProvider(provider);
        setIsEditProviderOpen(true);
    };

    const handleSelectForSummaries = (providerId: string) => {
        if (!providers) return;
        const provider = providers.find((p) => p.id === providerId);
        if (!provider) return;
        const previous = providers;
        onProvidersChange(
            providers.map((p) => ({
                ...p,
                isDefaultEnhancement: p.id === providerId,
            })),
        );
        void (async () => {
            try {
                await saveDefaultSummaries(provider);
                await refreshProviders();
            } catch (e) {
                onProvidersChange(previous);
                toast.error(
                    e instanceof Error
                        ? e.message
                        : "Failed to update provider",
                );
            }
        })();
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
                        const error = (await response.json()) as {
                            error?: string;
                        };
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

    const credentials = providers ? credentialsInOrder(providers) : [];
    const selectedId = providers ? summariesProviderId(providers) : undefined;

    return (
        <>
            <SettingsGroup
                title="Providers"
                description="Shared by transcription and summaries"
                action={
                    <Button
                        variant="ink"
                        size="compact"
                        onClick={() => setIsAddProviderOpen(true)}
                    >
                        <Plus />
                        Add provider
                    </Button>
                }
            >
                {providers === null &&
                    (loadFailed ? (
                        <SettingsCard
                            title="Couldn't load your AI providers."
                            action={
                                onRetry && (
                                    <Button
                                        variant="quiet"
                                        size="compact"
                                        onClick={onRetry}
                                    >
                                        Try again
                                    </Button>
                                )
                            }
                        />
                    ) : (
                        <ProvidersListSkeleton />
                    ))}

                {providers !== null && credentials.length === 0 && (
                    <SettingsCard
                        title="No providers yet"
                        description="Add one to write summaries and titles. Any OpenAI-compatible service works, or a model on your own server"
                    />
                )}

                {credentials.length > 0 && (
                    <OptionCardGroup
                        label="Provider for summaries and titles"
                        value={selectedId}
                        onValueChange={handleSelectForSummaries}
                    >
                        {credentials.map((provider) => {
                            const canSummarize = supportsEnhancement(
                                provider.provider,
                            );
                            const details = [
                                providerSummaryLine(provider),
                                canSummarize ? null : "Transcribes only",
                                provider.isDefaultTranscription
                                    ? "Used for transcription"
                                    : null,
                            ]
                                .filter(Boolean)
                                .join(" · ");
                            return (
                                <OptionCard
                                    key={provider.id}
                                    value={provider.id}
                                    selected={provider.id === selectedId}
                                    disabled={!canSummarize}
                                    icon={
                                        isLocalProvider(provider)
                                            ? Monitor
                                            : KeyRound
                                    }
                                    title={provider.provider}
                                    description={details || undefined}
                                    onSelect={handleSelectForSummaries}
                                    actions={
                                        <>
                                            <Button
                                                variant="ghost"
                                                size="icon-compact"
                                                onClick={() =>
                                                    handleEdit(provider)
                                                }
                                                aria-label={`Edit ${provider.provider}`}
                                            >
                                                <Pencil />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon-compact"
                                                onClick={() =>
                                                    handleDelete(provider.id)
                                                }
                                                disabled={
                                                    deletingId === provider.id
                                                }
                                                aria-label={`Delete ${provider.provider}`}
                                            >
                                                <Trash2 />
                                            </Button>
                                        </>
                                    }
                                />
                            );
                        })}
                    </OptionCardGroup>
                )}

                <div className="squircle flex gap-3.5 rounded-[var(--radius-card)] bg-quiet px-4.5 py-4">
                    <Info
                        className="mt-0.5 size-4.5 shrink-0 text-foreground"
                        aria-hidden="true"
                    />
                    <div className="flex flex-col gap-0.75">
                        <p className="text-ui font-semibold text-strong">
                            What gets sent
                        </p>
                        <p className="text-ui leading-5 text-subtle">
                            For summaries and titles, only transcript text,
                            never audio. It goes to the provider selected above.
                        </p>
                    </div>
                </div>
            </SettingsGroup>

            <AddProviderDialog
                open={isAddProviderOpen}
                onOpenChange={setIsAddProviderOpen}
                isHosted={isHosted}
                providers={providers ?? []}
                onSuccess={() => {
                    setIsAddProviderOpen(false);
                    refreshProviders();
                }}
            />

            <EditProviderDialog
                open={isEditProviderOpen}
                onOpenChange={setIsEditProviderOpen}
                provider={editingProvider}
                isHosted={isHosted}
                providers={providers ?? []}
                onSuccess={() => {
                    setIsEditProviderOpen(false);
                    refreshProviders();
                }}
            />
        </>
    );
}

function ProvidersListSkeleton() {
    return (
        <output
            className="flex flex-col gap-3"
            aria-busy="true"
            aria-label="Loading providers"
        >
            <div className="squircle h-21 animate-pulse rounded-[var(--radius-card)] border border-border bg-surface" />
            <div className="squircle h-21 animate-pulse rounded-[var(--radius-card)] border border-border bg-surface" />
        </output>
    );
}
