"use client";

import { Loader2, Plug, CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";
import { TranscriptionModelPicker } from "@/components/settings/transcription-model-picker";
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
import { findPreset, getVisiblePresets } from "@/lib/ai/provider-presets";

interface AddProviderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    /**
     * When true, hide the LM Studio / Ollama presets and show a hint that
     * localhost base URLs aren't reachable from the hosted app. The server
     * also rejects them — this is just a friendlier UI.
     */
    isHosted?: boolean;
}

export function AddProviderDialog({
    open,
    onOpenChange,
    onSuccess,
    isHosted = false,
}: AddProviderDialogProps) {
    const visiblePresets = getVisiblePresets({ isHosted });
    const [provider, setProvider] = useState("");
    const [nickname, setNickname] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const [defaultModel, setDefaultModel] = useState("");
    const [isDefaultTranscription, setIsDefaultTranscription] = useState(false);
    const [isDefaultEnhancement, setIsDefaultEnhancement] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<{
        ok: boolean;
        message: string;
    } | null>(null);
    const [discoveredModels, setDiscoveredModels] = useState<
        { id: string; name: string }[]
    >([]);

    const handleTestConnection = async () => {
        setIsTesting(true);
        setTestResult(null);
        setDiscoveredModels([]);
        try {
            const res = await fetch(
                "/api/settings/ai/providers/test-connection",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        provider,
                        apiKey,
                        baseUrl: baseUrl || null,
                    }),
                },
            );
            const data = await res.json();
            setTestResult({ ok: data.ok, message: data.message });
            if (data.ok && Array.isArray(data.models)) {
                setDiscoveredModels(data.models);
            }
        } catch {
            setTestResult({
                ok: false,
                message: "Failed to reach the test endpoint.",
            });
        } finally {
            setIsTesting(false);
        }
    };

    const handleProviderChange = (value: string) => {
        setProvider(value);
        setTestResult(null);
        setDiscoveredModels([]);
        const preset = findPreset(value);
        if (preset) {
            setBaseUrl(preset.baseUrl);
            setDefaultModel(preset.defaultModel);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!provider || !apiKey) {
            toast.error("Provider and API key are required");
            return;
        }

        setIsLoading(true);
        try {
            const response = await fetch("/api/settings/ai/providers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider,
                    apiKey,
                    baseUrl: baseUrl || null,
                    nickname: nickname.trim() || null,
                    defaultModel: defaultModel || null,
                    isDefaultTranscription,
                    isDefaultEnhancement,
                }),
            });

            if (!response.ok) {
                const data = await response.json().catch(() => null);
                throw new Error(data?.error || "Failed to add provider");
            }

            toast.success("AI provider added successfully");
            onSuccess();
            onOpenChange(false);

            setProvider("");
            setNickname("");
            setApiKey("");
            setBaseUrl("");
            setDefaultModel("");
            setIsDefaultTranscription(false);
            setIsDefaultEnhancement(false);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to add AI provider",
            );
        } finally {
            setIsLoading(false);
        }
    };

    const selectedPreset = findPreset(provider);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Add AI Provider</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label>Provider</Label>
                        <Select
                            value={provider}
                            onValueChange={handleProviderChange}
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
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="nickname">Nickname (Optional)</Label>
                        <Input
                            id="nickname"
                            type="text"
                            placeholder="e.g. My Whisper Server"
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            disabled={isLoading}
                            className="text-sm"
                            maxLength={100}
                        />
                        <p className="text-xs text-muted-foreground">
                            A friendly name to help you identify this provider
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="apiKey">API Key</Label>
                        <Input
                            id="apiKey"
                            type="password"
                            placeholder={
                                selectedPreset?.placeholder || "Your API key"
                            }
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            disabled={isLoading}
                            className="font-mono text-sm"
                        />
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
                                use LM Studio or Ollama, self-host Mesynx AI (
                                <code className="font-mono">
                                    docker compose up
                                </code>
                                ).
                            </p>
                        )}
                        <button
                            type="button"
                            onClick={handleTestConnection}
                            disabled={isTesting || !provider}
                            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                        >
                            {isTesting ? (
                                <Loader2 className="size-3 animate-spin" />
                            ) : (
                                <Plug className="size-3" />
                            )}
                            {isTesting ? "Testing..." : "Test Connection"}
                        </button>
                        {testResult && (
                            <div
                                className={`flex items-start gap-2 rounded-md border p-2 text-xs ${
                                    testResult.ok
                                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                        : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                                }`}
                            >
                                {testResult.ok ? (
                                    <CheckCircle2 className="size-3.5 shrink-0 mt-0.5" />
                                ) : (
                                    <XCircle className="size-3.5 shrink-0 mt-0.5" />
                                )}
                                <span>{testResult.message}</span>
                            </div>
                        )}
                    </div>

                    <TranscriptionModelPicker
                        preset={selectedPreset}
                        apiKey={apiKey}
                        baseUrl={baseUrl}
                        value={defaultModel}
                        onChange={setDefaultModel}
                        disabled={isLoading}
                        discoveredModels={discoveredModels}
                    />

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
                            variant="cyan"
                            disabled={isLoading}
                            className="flex-1"
                        >
                            {isLoading ? "Adding..." : "Add Provider"}
                        </MetalButton>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
