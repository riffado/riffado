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

// ISO-639-1 codes from Whisper's supported-languages list. Sticking to
// languages with non-trivial user populations to keep the dropdown
// scannable. Auto-detect already covers everything Whisper handles —
// these entries just let users force a language for noisy recordings
// or when auto-detect mis-routes (Slavic / Romance neighbours).
const languageOptions = [
    { label: "Auto-detect", value: null },
    { label: "English", value: "en" },
    { label: "Spanish", value: "es" },
    { label: "French", value: "fr" },
    { label: "German", value: "de" },
    { label: "Italian", value: "it" },
    { label: "Portuguese", value: "pt" },
    { label: "Dutch", value: "nl" },
    { label: "Swedish", value: "sv" },
    { label: "Danish", value: "da" },
    { label: "Norwegian", value: "no" },
    { label: "Finnish", value: "fi" },
    { label: "Polish", value: "pl" },
    { label: "Czech", value: "cs" },
    { label: "Ukrainian", value: "uk" },
    { label: "Russian", value: "ru" },
    { label: "Romanian", value: "ro" },
    { label: "Hungarian", value: "hu" },
    { label: "Greek", value: "el" },
    { label: "Turkish", value: "tr" },
    { label: "Arabic", value: "ar" },
    { label: "Hebrew", value: "he" },
    { label: "Hindi", value: "hi" },
    { label: "Indonesian", value: "id" },
    { label: "Vietnamese", value: "vi" },
    { label: "Thai", value: "th" },
    { label: "Chinese", value: "zh" },
    { label: "Japanese", value: "ja" },
    { label: "Korean", value: "ko" },
];

const qualityOptions = [
    {
        label: "Fast",
        value: "fast",
        description: "Faster transcription, lower accuracy",
    },
    {
        label: "Balanced",
        value: "balanced",
        description: "Good balance of speed and accuracy",
    },
    {
        label: "Accurate",
        value: "accurate",
        description: "Highest accuracy, slower transcription",
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
            toast.error("Failed to save settings. Changes reverted.");
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
            toast.error("Failed to save settings. Changes reverted.");
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
            toast.error("Failed to save settings. Changes reverted.");
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
                title="Transcription"
                description="Defaults and provider selection for converting audio to text."
                icon={FileText}
            />
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label htmlFor="auto-transcribe" className="text-base">
                            Auto-transcribe new recordings
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Automatically transcribe recordings when they are
                            synced from your Plaud device
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
                            Import Plaud transcripts and summaries
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            When Plaud already transcribed a recording, import
                            its transcript and summary on sync instead of
                            re-doing the work with your own AI provider.
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
                                When Plaud has a transcript
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
                                        Use Plaud only (saves AI credits)
                                    </SelectItem>
                                    <SelectItem value="keep_both">
                                        Keep both — also run my provider
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Keep both also transcribes with your own
                                provider so you can compare them.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="preferred-transcript-source">
                                Primary transcript
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
                                        My provider
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Shown by default and used for summaries when
                                both exist.
                            </p>
                        </div>
                    </>
                )}

                <div className="space-y-2">
                    <Label htmlFor="transcription-language">
                        Default transcription language
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
                                )?.label || "Auto-detect"}
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
                        Language to use for transcription. Auto-detect will
                        identify the language automatically.
                    </p>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="transcription-quality">
                        Transcription quality
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
                                )?.label || "Balanced"}
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
                        Balance between transcription speed and accuracy
                    </p>
                </div>

                <div className="flex items-center justify-between">
                    <div className="space-y-0.5 flex-1">
                        <Label
                            htmlFor="auto-generate-title"
                            className="text-base"
                        >
                            Auto-generate titles
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Automatically generate descriptive titles from
                            transcriptions using AI
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
                                Sync titles to Plaud
                            </Label>
                            <p className="text-sm text-muted-foreground">
                                Update the filename in your Plaud device when
                                titles are generated
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
