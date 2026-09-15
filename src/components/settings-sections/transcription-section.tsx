"use client";

import { FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import { uiText } from "@/lib/i18n";

// ISO-639-1 codes from Whisper's supported-languages list. Sticking to
// languages with non-trivial user populations to keep the dropdown
// scannable. Auto-detect already covers everything Whisper handles —
// these entries just let users force a language for noisy recordings
// or when auto-detect mis-routes (Slavic / Romance neighbours).
const languageOptions = [
    { label: uiText("Auto-detect"), value: null },
    { label: uiText("English"), value: "en" },
    { label: uiText("Spanish"), value: "es" },
    { label: uiText("French"), value: "fr" },
    { label: uiText("German"), value: "de" },
    { label: uiText("Italian"), value: "it" },
    { label: uiText("Portuguese"), value: "pt" },
    { label: uiText("Dutch"), value: "nl" },
    { label: uiText("Swedish"), value: "sv" },
    { label: uiText("Danish"), value: "da" },
    { label: uiText("Norwegian"), value: "no" },
    { label: uiText("Finnish"), value: "fi" },
    { label: uiText("Polish"), value: "pl" },
    { label: uiText("Czech"), value: "cs" },
    { label: uiText("Ukrainian"), value: "uk" },
    { label: uiText("Russian"), value: "ru" },
    { label: uiText("Romanian"), value: "ro" },
    { label: uiText("Hungarian"), value: "hu" },
    { label: uiText("Greek"), value: "el" },
    { label: uiText("Turkish"), value: "tr" },
    { label: uiText("Arabic"), value: "ar" },
    { label: uiText("Hebrew"), value: "he" },
    { label: uiText("Hindi"), value: "hi" },
    { label: uiText("Indonesian"), value: "id" },
    { label: uiText("Vietnamese"), value: "vi" },
    { label: uiText("Thai"), value: "th" },
    { label: uiText("Chinese"), value: "zh" },
    { label: uiText("Japanese"), value: "ja" },
    { label: uiText("Korean"), value: "ko" },
];

const qualityOptions = [
    {
        label: uiText("Fast"),
        value: "fast",
        description: uiText("Faster transcription, lower accuracy"),
    },
    {
        label: uiText("Balanced"),
        value: "balanced",
        description: uiText("Good balance of speed and accuracy"),
    },
    {
        label: uiText("Accurate"),
        value: "accurate",
        description: uiText("Highest accuracy, slower transcription"),
    },
];

export function TranscriptionSection() {
    const { isLoadingSettings, isSavingSettings, setIsLoadingSettings } =
        useSettings();
    const [autoTranscribe, setAutoTranscribe] = useState(false);
    const [defaultTranscriptionLanguage, setDefaultTranscriptionLanguage] =
        useState<string | null>(null);
    const [transcriptionQuality, setTranscriptionQuality] =
        useState("balanced");
    const [autoGenerateTitle, setAutoGenerateTitle] = useState(true);
    const [syncTitleToPlaud, setSyncTitleToPlaud] = useState(false);
    const [importPlaudContent, setImportPlaudContent] = useState(false);
    const [transcriptMode, setTranscriptMode] = useState("plaud_only");
    const [preferredTranscriptSource, setPreferredTranscriptSource] =
        useState("plaud");
    const pendingChangesRef = useRef<Map<string, unknown>>(new Map());

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch("/api/settings/user");
                if (response.ok) {
                    const data = await response.json();
                    setAutoTranscribe(data.autoTranscribe ?? false);
                    setDefaultTranscriptionLanguage(
                        data.defaultTranscriptionLanguage ?? null,
                    );
                    setTranscriptionQuality(
                        data.transcriptionQuality ?? "balanced",
                    );
                    setAutoGenerateTitle(data.autoGenerateTitle ?? true);
                    setSyncTitleToPlaud(data.syncTitleToPlaud ?? false);
                    setImportPlaudContent(data.importPlaudContent ?? false);
                    setTranscriptMode(data.transcriptMode ?? "plaud_only");
                    setPreferredTranscriptSource(
                        data.preferredTranscriptSource ?? "plaud",
                    );
                }
            } catch (error) {
                console.error("Failed to fetch settings:", error);
            } finally {
                setIsLoadingSettings(false);
            }
        };
        fetchSettings();
    }, [setIsLoadingSettings]);

    const handleAutoTranscribeChange = async (checked: boolean) => {
        const previous = autoTranscribe;
        setAutoTranscribe(checked);
        pendingChangesRef.current.set("autoTranscribe", previous);

        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ autoTranscribe: checked }),
            });

            if (!response.ok) {
                throw new Error("Failed to save settings");
            }

            pendingChangesRef.current.delete("autoTranscribe");
        } catch {
            setAutoTranscribe(previous);
            pendingChangesRef.current.delete("autoTranscribe");
            toast.error(uiText("Failed to save settings. Changes reverted."));
        }
    };

    const handleImportSettingChange = async (updates: {
        importPlaudContent?: boolean;
        transcriptMode?: string;
        preferredTranscriptSource?: string;
    }) => {
        const prev = {
            importPlaudContent,
            transcriptMode,
            preferredTranscriptSource,
        };
        if (updates.importPlaudContent !== undefined) {
            setImportPlaudContent(updates.importPlaudContent);
        }
        if (updates.transcriptMode !== undefined) {
            setTranscriptMode(updates.transcriptMode);
        }
        if (updates.preferredTranscriptSource !== undefined) {
            setPreferredTranscriptSource(updates.preferredTranscriptSource);
        }

        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });
            if (!response.ok) {
                throw new Error("Failed to save settings");
            }
        } catch {
            setImportPlaudContent(prev.importPlaudContent);
            setTranscriptMode(prev.transcriptMode);
            setPreferredTranscriptSource(prev.preferredTranscriptSource);
            toast.error(uiText("Failed to save settings. Changes reverted."));
        }
    };

    const handleTranscriptionSettingChange = async (updates: {
        defaultTranscriptionLanguage?: string | null;
        transcriptionQuality?: string;
        autoGenerateTitle?: boolean;
        syncTitleToPlaud?: boolean;
    }) => {
        if (updates.defaultTranscriptionLanguage !== undefined) {
            const previous = defaultTranscriptionLanguage;
            setDefaultTranscriptionLanguage(
                updates.defaultTranscriptionLanguage,
            );
            pendingChangesRef.current.set(
                "defaultTranscriptionLanguage",
                previous,
            );
        }
        if (updates.transcriptionQuality !== undefined) {
            const previous = transcriptionQuality;
            setTranscriptionQuality(updates.transcriptionQuality);
            pendingChangesRef.current.set("transcriptionQuality", previous);
        }
        if (updates.autoGenerateTitle !== undefined) {
            const previous = autoGenerateTitle;
            setAutoGenerateTitle(updates.autoGenerateTitle);
            pendingChangesRef.current.set("autoGenerateTitle", previous);
        }
        if (updates.syncTitleToPlaud !== undefined) {
            const previous = syncTitleToPlaud;
            setSyncTitleToPlaud(updates.syncTitleToPlaud);
            pendingChangesRef.current.set("syncTitleToPlaud", previous);
        }

        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });

            if (!response.ok) {
                throw new Error("Failed to save settings");
            }

            if (updates.defaultTranscriptionLanguage !== undefined) {
                pendingChangesRef.current.delete(
                    "defaultTranscriptionLanguage",
                );
            }
            if (updates.transcriptionQuality !== undefined) {
                pendingChangesRef.current.delete("transcriptionQuality");
            }
            if (updates.autoGenerateTitle !== undefined) {
                pendingChangesRef.current.delete("autoGenerateTitle");
            }
            if (updates.syncTitleToPlaud !== undefined) {
                pendingChangesRef.current.delete("syncTitleToPlaud");
            }
        } catch {
            if (updates.defaultTranscriptionLanguage !== undefined) {
                const previous = pendingChangesRef.current.get(
                    "defaultTranscriptionLanguage",
                );
                if (
                    previous !== undefined &&
                    (typeof previous === "string" || previous === null)
                ) {
                    setDefaultTranscriptionLanguage(previous);
                    pendingChangesRef.current.delete(
                        "defaultTranscriptionLanguage",
                    );
                }
            }
            if (updates.transcriptionQuality !== undefined) {
                const previous = pendingChangesRef.current.get(
                    "transcriptionQuality",
                );
                if (previous !== undefined && typeof previous === "string") {
                    setTranscriptionQuality(previous);
                    pendingChangesRef.current.delete("transcriptionQuality");
                }
            }
            if (updates.autoGenerateTitle !== undefined) {
                const previous =
                    pendingChangesRef.current.get("autoGenerateTitle");
                if (previous !== undefined && typeof previous === "boolean") {
                    setAutoGenerateTitle(previous);
                    pendingChangesRef.current.delete("autoGenerateTitle");
                }
            }
            if (updates.syncTitleToPlaud !== undefined) {
                const previous =
                    pendingChangesRef.current.get("syncTitleToPlaud");
                if (previous !== undefined && typeof previous === "boolean") {
                    setSyncTitleToPlaud(previous);
                    pendingChangesRef.current.delete("syncTitleToPlaud");
                }
            }
            toast.error(uiText("Failed to save settings. Changes reverted."));
        }
    };

    if (isLoadingSettings) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="animate-spin size-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <SettingsSectionHeader
                title={uiText("Transcription")}
                description={uiText(
                    "Defaults and provider selection for converting audio to text.",
                )}
                icon={FileText}
            />
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label htmlFor="auto-transcribe" className="text-base">
                            {uiText("Auto-transcribe new recordings")}
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            {uiText(
                                "Automatically transcribe recordings when they are synced from your Plaud device",
                            )}
                        </p>
                    </div>
                    <Switch
                        id="auto-transcribe"
                        checked={autoTranscribe}
                        onCheckedChange={handleAutoTranscribeChange}
                        disabled={isSavingSettings}
                    />
                </div>

                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label
                            htmlFor="import-plaud-content"
                            className="text-base"
                        >
                            {uiText("Import Plaud transcripts and summaries")}
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            {uiText(
                                "When Plaud already transcribed a recording, import its transcript and summary on sync instead of re-doing the work with your own AI provider.",
                            )}
                        </p>
                    </div>
                    <Switch
                        id="import-plaud-content"
                        checked={importPlaudContent}
                        onCheckedChange={(checked) =>
                            handleImportSettingChange({
                                importPlaudContent: checked,
                            })
                        }
                        disabled={isSavingSettings}
                    />
                </div>

                {importPlaudContent && (
                    <>
                        <div className="space-y-2">
                            <Label htmlFor="transcript-mode">
                                {uiText("When Plaud has a transcript")}
                            </Label>
                            <Select
                                value={transcriptMode}
                                onValueChange={(value) =>
                                    handleImportSettingChange({
                                        transcriptMode: value,
                                    })
                                }
                                disabled={isSavingSettings}
                            >
                                <SelectTrigger
                                    id="transcript-mode"
                                    className="w-full"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="plaud_only">
                                        {uiText(
                                            "Use Plaud only (saves AI credits)",
                                        )}
                                    </SelectItem>
                                    <SelectItem value="keep_both">
                                        {uiText(
                                            "Keep both — also run my provider",
                                        )}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                {uiText(
                                    "Keep both also transcribes with your own provider so you can compare them.",
                                )}
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="preferred-transcript-source">
                                {uiText("Primary transcript")}
                            </Label>
                            <Select
                                value={preferredTranscriptSource}
                                onValueChange={(value) =>
                                    handleImportSettingChange({
                                        preferredTranscriptSource: value,
                                    })
                                }
                                disabled={isSavingSettings}
                            >
                                <SelectTrigger
                                    id="preferred-transcript-source"
                                    className="w-full"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="plaud">Plaud</SelectItem>
                                    <SelectItem value="riffado">
                                        {uiText("My provider")}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                {uiText(
                                    "Shown by default and used for summaries when both exist.",
                                )}
                            </p>
                        </div>
                    </>
                )}

                <div className="space-y-2">
                    <Label htmlFor="transcription-language">
                        {uiText("Default transcription language")}
                    </Label>
                    <Select
                        value={defaultTranscriptionLanguage || "auto"}
                        onValueChange={(value) => {
                            const lang = value === "auto" ? null : value;
                            setDefaultTranscriptionLanguage(lang);
                            handleTranscriptionSettingChange({
                                defaultTranscriptionLanguage: lang,
                            });
                        }}
                        disabled={isSavingSettings}
                    >
                        <SelectTrigger
                            id="transcription-language"
                            className="w-full"
                        >
                            <SelectValue>
                                {languageOptions.find(
                                    (opt) =>
                                        opt.value ===
                                        defaultTranscriptionLanguage,
                                )?.label || uiText("Auto-detect")}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            {languageOptions.map((option) => (
                                <SelectItem
                                    key={option.value || "auto"}
                                    value={option.value || "auto"}
                                >
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        {uiText(
                            "Language to use for transcription. Auto-detect will identify the language automatically.",
                        )}
                    </p>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="transcription-quality">
                        {uiText("Transcription quality")}
                    </Label>
                    <Select
                        value={transcriptionQuality}
                        onValueChange={(value) => {
                            setTranscriptionQuality(value);
                            handleTranscriptionSettingChange({
                                transcriptionQuality: value,
                            });
                        }}
                        disabled={isSavingSettings}
                    >
                        <SelectTrigger
                            id="transcription-quality"
                            className="w-full"
                        >
                            <SelectValue>
                                {qualityOptions.find(
                                    (opt) => opt.value === transcriptionQuality,
                                )?.label || uiText("Balanced")}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            {qualityOptions.map((option) => (
                                <SelectItem
                                    key={option.value}
                                    value={option.value}
                                >
                                    <div>
                                        <div>{option.label}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {option.description}
                                        </div>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        {uiText(
                            "Balance between transcription speed and accuracy",
                        )}
                    </p>
                </div>

                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label
                            htmlFor="auto-generate-title"
                            className="text-base"
                        >
                            {uiText("Auto-generate titles")}
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            {uiText(
                                "Automatically generate descriptive titles from transcriptions using AI",
                            )}
                        </p>
                    </div>
                    <Switch
                        id="auto-generate-title"
                        checked={autoGenerateTitle}
                        onCheckedChange={(checked) => {
                            setAutoGenerateTitle(checked);
                            handleTranscriptionSettingChange({
                                autoGenerateTitle: checked,
                            });
                        }}
                        disabled={isSavingSettings}
                    />
                </div>

                {autoGenerateTitle && (
                    <div className="flex items-center justify-between pl-4 border-l-2 border-primary/20">
                        <div className="space-y-0.5 flex-1">
                            <Label
                                htmlFor="sync-title-plaud"
                                className="text-base"
                            >
                                {uiText("Sync titles to Plaud")}
                            </Label>
                            <p className="text-sm text-muted-foreground">
                                {uiText(
                                    "Update the filename in your Plaud device when titles are generated",
                                )}
                            </p>
                        </div>
                        <Switch
                            id="sync-title-plaud"
                            checked={syncTitleToPlaud}
                            onCheckedChange={(checked) => {
                                setSyncTitleToPlaud(checked);
                                handleTranscriptionSettingChange({
                                    syncTitleToPlaud: checked,
                                });
                            }}
                            disabled={isSavingSettings}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
