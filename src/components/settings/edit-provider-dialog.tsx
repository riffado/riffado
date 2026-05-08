"use client";

import { AlertTriangle, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    findPreset,
    getVisiblePresets,
    isLocalPreset,
} from "@/lib/ai/provider-presets";

interface Provider {
    id: string;
    provider: string;
    baseUrl: string | null;
    defaultModel: string | null;
    isDefaultTranscription: boolean;
    isDefaultEnhancement: boolean;
}

interface EditProviderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    provider: Provider | null;
    onSuccess: () => void;
    /**
     * When true, hide the LM Studio / Ollama presets and show a hint that
     * localhost base URLs aren't reachable from the hosted app. The server
     * also rejects them on save.
     */
    isHosted?: boolean;
}

export function EditProviderDialog({
    open,
    onOpenChange,
    provider,
    onSuccess,
    isHosted = false,
}: EditProviderDialogProps) {
    const visiblePresets = getVisiblePresets({ isHosted });
    // Legacy case: a hosted user has an existing LM Studio / Ollama provider
    // (added before hosted enforcement, or imported). Keep their currently
    // selected preset visible in the dropdown — disabled — so the Select
    // doesn't render an empty trigger. The save will still fail server-side
    // because the stored baseUrl is loopback; we surface a notice so the
    // user knows to delete and re-add with a public endpoint.
    const legacyLocalProvider =
        isHosted && provider != null && isLocalPreset(provider.provider)
            ? provider.provider
            : null;
    const [providerName, setProviderName] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const [defaultModel, setDefaultModel] = useState("");
    const [isDefaultTranscription, setIsDefaultTranscription] = useState(false);
    const [isDefaultEnhancement, setIsDefaultEnhancement] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (open && provider) {
            setProviderName(provider.provider);
            setBaseUrl(provider.baseUrl || "");
            setDefaultModel(provider.defaultModel || "");
            setIsDefaultTranscription(provider.isDefaultTranscription);
            setIsDefaultEnhancement(provider.isDefaultEnhancement);
            setApiKey("");
        } else if (!open) {
            setProviderName("");
            setApiKey("");
            setBaseUrl("");
            setDefaultModel("");
            setIsDefaultTranscription(false);
            setIsDefaultEnhancement(false);
        }
    }, [open, provider]);

    const handleProviderChange = (value: string) => {
        setProviderName(value);
        const preset = findPreset(value);
        if (preset) {
            setBaseUrl(preset.baseUrl);
            setDefaultModel(preset.defaultModel);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!providerName) {
            toast.error("Provider name is required");
            return;
        }

        if (!provider?.id) {
            toast.error("Provider ID is missing");
            return;
        }

        setIsLoading(true);
        try {
            const updateData: {
                baseUrl: string | null;
                defaultModel: string | null;
                isDefaultTranscription: boolean;
                isDefaultEnhancement: boolean;
                apiKey?: string;
            } = {
                baseUrl: baseUrl || null,
                defaultModel: defaultModel || null,
                isDefaultTranscription,
                isDefaultEnhancement,
            };

            if (apiKey.trim()) {
                updateData.apiKey = apiKey;
            }

            const response = await fetch(
                `/api/settings/ai/providers/${provider.id}`,
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(updateData),
                },
            );

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || "Failed to update provider");
            }

            toast.success("AI provider updated successfully");
            onSuccess();
            onOpenChange(false);

            setProviderName("");
            setApiKey("");
            setBaseUrl("");
            setDefaultModel("");
            setIsDefaultTranscription(false);
            setIsDefaultEnhancement(false);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to update AI provider",
            );
        } finally {
            setIsLoading(false);
        }
    };

    const selectedPreset = findPreset(providerName);

    if (!open || !provider) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange} key={provider.id}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Edit AI Provider</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label>Provider</Label>
                        <Select
                            value={providerName}
                            onValueChange={handleProviderChange}
                            disabled={isLoading}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select a provider" />
                            </SelectTrigger>
                            <SelectContent>
                                {visiblePresets.map((preset) => (
                                    <SelectItem
                                        key={preset.name}
                                        value={preset.name}
                                    >
                                        {preset.name}
                                    </SelectItem>
                                ))}
                                {legacyLocalProvider && (
                                    <SelectItem
                                        key={legacyLocalProvider}
                                        value={legacyLocalProvider}
                                        disabled
                                    >
                                        {legacyLocalProvider} (not available on
                                        hosted)
                                    </SelectItem>
                                )}
                            </SelectContent>
                        </Select>
                        {legacyLocalProvider && (
                            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                <span>
                                    {legacyLocalProvider} isn&apos;t usable on
                                    the hosted app — we can&apos;t reach your
                                    machine. Delete this provider and re-add one
                                    with a public endpoint, or self-host
                                    OpenPlaud (
                                    <code className="font-mono">
                                        docker compose up
                                    </code>
                                    ).
                                </span>
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="apiKey">API Key</Label>
                        <Input
                            id="apiKey"
                            type="password"
                            placeholder={
                                selectedPreset?.placeholder ||
                                "Enter a new key to replace the current one"
                            }
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            disabled={isLoading}
                            className="font-mono text-sm"
                        />
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                            <Shield className="w-3.5 h-3.5 shrink-0" />
                            <span>
                                For security, the saved API key is never shown.
                                Leave this blank to keep your current key, or
                                enter a new key to replace it.
                            </span>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="baseUrl">Base URL (Optional)</Label>
                        <Input
                            id="baseUrl"
                            type="text"
                            placeholder="https://api.example.com/v1"
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            disabled={isLoading}
                            className="font-mono text-sm"
                        />
                        {isHosted && (
                            <p className="text-xs text-muted-foreground">
                                We can&apos;t reach{" "}
                                <code className="font-mono">localhost</code> or
                                other private addresses from the hosted app. To
                                use LM Studio or Ollama, self-host OpenPlaud (
                                <code className="font-mono">
                                    docker compose up
                                </code>
                                ).
                            </p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="defaultModel">
                            Default Model (Optional)
                        </Label>
                        <Input
                            id="defaultModel"
                            type="text"
                            placeholder="whisper-1, gpt-4o, etc."
                            value={defaultModel}
                            onChange={(e) => setDefaultModel(e.target.value)}
                            disabled={isLoading}
                            className="font-mono text-sm"
                        />
                    </div>

                    <Panel variant="inset" className="space-y-2 text-sm">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={isDefaultTranscription}
                                onChange={(e) =>
                                    setIsDefaultTranscription(e.target.checked)
                                }
                                disabled={isLoading}
                            />
                            <span>Use for transcription</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={isDefaultEnhancement}
                                onChange={(e) =>
                                    setIsDefaultEnhancement(e.target.checked)
                                }
                                disabled={isLoading}
                            />
                            <span>Use for AI enhancements</span>
                        </label>
                    </Panel>

                    <div className="flex gap-2">
                        <MetalButton
                            type="button"
                            onClick={() => onOpenChange(false)}
                            disabled={isLoading}
                            className="flex-1"
                        >
                            Cancel
                        </MetalButton>
                        <MetalButton
                            type="submit"
                            disabled={isLoading}
                            className="flex-1"
                        >
                            {isLoading ? "Updating..." : "Update Provider"}
                        </MetalButton>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
