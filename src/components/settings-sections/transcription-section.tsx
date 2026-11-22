"use client";

import { KeyRound, Monitor, Server } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
    OptionCard,
    OptionCardGroup,
    OptionCardPanel,
} from "@/components/settings/option-card";
import {
    credentialsInOrder,
    fetchProviders,
    isLocalProvider,
    providerSummaryLine,
    saveDefaultTranscription,
} from "@/components/settings/provider-actions";
import { SettingsGroup } from "@/components/settings/section-header";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsSelectTrigger } from "@/components/settings/settings-select";
import {
    SettingsRow,
    SettingsRows,
    SettingsRowsSkeleton,
    ToggleRow,
} from "@/components/settings/toggle-row";
import type { Provider } from "@/components/settings-sections/providers-section";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/use-settings";
import { toast } from "@/lib/toast";

// ISO-639-1 codes from Whisper's supported-languages list. Sticking to
// languages with non-trivial user populations to keep the dropdown
// scannable. Auto-detect already covers everything Whisper handles —
// these entries just let users force a language for noisy recordings
// or when auto-detect mis-routes (Slavic / Romance neighbours).
const languageOptions = [
    { label: "Detect automatically", value: null },
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

function formatIncludedSeconds(seconds: number | undefined): string {
    if (!seconds) return "Included with your subscription";
    return `Up to ${Math.round(seconds / 3600)}h of transcription per month`;
}

interface TranscriptionSectionProps {
    /** The shared provider list (also managed on AI for summaries); null while loading. */
    providers: Provider[] | null;
    /** Receives the list re-read after the transcription default changes. */
    onProvidersChange: (providers: Provider[]) => void;
}

/**
 * Which provider transcribes, as option cards over the shared provider
 * list, plus the transcription defaults. Providers are added and edited
 * on AI for summaries; the "Your own provider" card links there.
 */
export function TranscriptionSection({
    providers,
    onProvidersChange,
}: TranscriptionSectionProps) {
    const { isLoadingSettings, isSavingSettings, setIsLoadingSettings } =
        useSettings();
    const [isSaving, setIsSaving] = useState(false);
    const [autoTranscribe, setAutoTranscribe] = useState(false);
    const [defaultTranscriptionLanguage, setDefaultTranscriptionLanguage] =
        useState<string | null>(null);
    const [transcriptionQuality, setTranscriptionQuality] =
        useState("balanced");
    const [speakerDiarization, setSpeakerDiarization] = useState(true);
    const [diarizationSpeakerCount, setDiarizationSpeakerCount] = useState<
        number | null
    >(null);
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
                    setSpeakerDiarization(data.speakerDiarization ?? true);
                    setDiarizationSpeakerCount(
                        data.diarizationSpeakerCount ?? null,
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

    const handleSelectProvider = (providerId: string) => {
        if (!providers) return;
        const previous = providers;
        onProvidersChange(
            providers.map((p) => ({
                ...p,
                isDefaultTranscription: p.id === providerId,
            })),
        );
        void (async () => {
            try {
                await saveDefaultTranscription(providerId);
                onProvidersChange(await fetchProviders());
            } catch (e) {
                onProvidersChange(previous);
                toast.error(
                    e instanceof Error ? e.message : "Failed to update default",
                );
            }
        })();
    };

    const handleAutoTranscribeChange = async (checked: boolean) => {
        const previous = autoTranscribe;
        setAutoTranscribe(checked);
        pendingChangesRef.current.set("autoTranscribe", previous);

        setIsSaving(true);
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
        } finally {
            setIsSaving(false);
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

        setIsSaving(true);
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
        } finally {
            setIsSaving(false);
        }
    };

    const handleTranscriptionSettingChange = async (updates: {
        defaultTranscriptionLanguage?: string | null;
        transcriptionQuality?: string;
        speakerDiarization?: boolean;
        diarizationSpeakerCount?: number | null;
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
        if (updates.speakerDiarization !== undefined) {
            const previous = speakerDiarization;
            setSpeakerDiarization(updates.speakerDiarization);
            pendingChangesRef.current.set("speakerDiarization", previous);
        }
        if (updates.diarizationSpeakerCount !== undefined) {
            const previous = diarizationSpeakerCount;
            setDiarizationSpeakerCount(updates.diarizationSpeakerCount);
            pendingChangesRef.current.set("diarizationSpeakerCount", previous);
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

        setIsSaving(true);
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
            if (updates.speakerDiarization !== undefined) {
                pendingChangesRef.current.delete("speakerDiarization");
            }
            if (updates.diarizationSpeakerCount !== undefined) {
                pendingChangesRef.current.delete("diarizationSpeakerCount");
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
            if (updates.speakerDiarization !== undefined) {
                const previous =
                    pendingChangesRef.current.get("speakerDiarization");
                if (previous !== undefined && typeof previous === "boolean") {
                    setSpeakerDiarization(previous);
                    pendingChangesRef.current.delete("speakerDiarization");
                }
            }
            if (updates.diarizationSpeakerCount !== undefined) {
                const previous = pendingChangesRef.current.get(
                    "diarizationSpeakerCount",
                );
                if (
                    previous !== undefined &&
                    (typeof previous === "number" || previous === null)
                ) {
                    setDiarizationSpeakerCount(previous);
                    pendingChangesRef.current.delete("diarizationSpeakerCount");
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
        } finally {
            setIsSaving(false);
        }
    };

    const disabled = isSavingSettings || isSaving;
    const managed = providers?.find((p) => p.managed === true) ?? null;
    const credentials = providers ? credentialsInOrder(providers) : [];
    const selectedId = providers?.find((p) => p.isDefaultTranscription)?.id;

    return (
        <div className="flex flex-col gap-11">
            <SettingsGroup>
                {providers === null ? (
                    <output
                        className="squircle block h-27 animate-pulse rounded-[var(--radius-card)] border border-border bg-surface"
                        aria-busy="true"
                        aria-label="Loading providers"
                    />
                ) : managed || credentials.length > 0 ? (
                    <OptionCardGroup
                        label="Transcription provider"
                        value={selectedId}
                        onValueChange={handleSelectProvider}
                    >
                        {managed && (
                            <OptionCard
                                value={managed.id}
                                selected={managed.isDefaultTranscription}
                                icon={Server}
                                title={managed.provider}
                                description={
                                    managed.available === false
                                        ? "Not part of your current plan. Resubscribe to use it again"
                                        : "Included with your Riffado plan"
                                }
                                disabled={managed.available === false}
                                onSelect={handleSelectProvider}
                            >
                                <OptionCardPanel>
                                    {formatIncludedSeconds(
                                        managed.includedSeconds,
                                    )}
                                </OptionCardPanel>
                            </OptionCard>
                        )}
                        {credentials.map((provider) => (
                            <OptionCard
                                key={provider.id}
                                value={provider.id}
                                selected={provider.isDefaultTranscription}
                                icon={
                                    isLocalProvider(provider)
                                        ? Monitor
                                        : KeyRound
                                }
                                title={provider.provider}
                                description={
                                    providerSummaryLine(provider) ??
                                    "Audio is sent to this provider"
                                }
                                onSelect={handleSelectProvider}
                            />
                        ))}
                    </OptionCardGroup>
                ) : null}
                {providers !== null && credentials.length === 0 ? (
                    <SettingsCard
                        title="Your own provider"
                        description="Any OpenAI-compatible service, or a model on your own server. Audio is sent to it"
                        action={
                            <Button asChild variant="quiet" size="compact">
                                <a href="#providers">Add a provider</a>
                            </Button>
                        }
                    />
                ) : (
                    <p className="text-ui text-subtle">
                        Summaries use the same providers.{" "}
                        <a
                            href="#providers"
                            className="font-medium text-strong underline-offset-4 hover:underline"
                        >
                            Add or edit providers
                        </a>
                    </p>
                )}
            </SettingsGroup>

            {isLoadingSettings ? (
                <SettingsRowsSkeleton rows={5} />
            ) : (
                <>
                    <SettingsRows>
                        <ToggleRow
                            id="auto-transcribe"
                            label="Transcribe new recordings automatically"
                            description="As soon as they sync from your recorder"
                            checked={autoTranscribe}
                            onCheckedChange={handleAutoTranscribeChange}
                            disabled={disabled}
                        />
                        <SettingsRow
                            label="Language"
                            description="Set one if auto-detect gets it wrong"
                            controlId="transcription-language"
                            control={
                                <Select
                                    value={
                                        defaultTranscriptionLanguage || "auto"
                                    }
                                    onValueChange={(value) => {
                                        const lang =
                                            value === "auto" ? null : value;
                                        setDefaultTranscriptionLanguage(lang);
                                        handleTranscriptionSettingChange({
                                            defaultTranscriptionLanguage: lang,
                                        });
                                    }}
                                    disabled={disabled}
                                >
                                    <SettingsSelectTrigger id="transcription-language">
                                        <SelectValue>
                                            {languageOptions.find(
                                                (opt) =>
                                                    opt.value ===
                                                    defaultTranscriptionLanguage,
                                            )?.label || "Detect automatically"}
                                        </SelectValue>
                                    </SettingsSelectTrigger>
                                    <SelectContent align="end">
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
                            }
                        />
                        <ToggleRow
                            id="speaker-diarization"
                            label="Separate speakers"
                            description="Labels who is talking (Speaker 1, Speaker 2). ElevenLabs Scribe supports it; other providers ignore it"
                            checked={speakerDiarization}
                            onCheckedChange={(checked) => {
                                setSpeakerDiarization(checked);
                                handleTranscriptionSettingChange({
                                    speakerDiarization: checked,
                                });
                            }}
                            disabled={disabled}
                        />
                        {speakerDiarization && (
                            <SettingsRow
                                label="Expected speakers"
                                description="A hint, not a hard limit. Auto works for most recordings"
                                controlId="diarization-speaker-count"
                                control={
                                    <Select
                                        value={
                                            diarizationSpeakerCount === null
                                                ? "auto"
                                                : String(
                                                      diarizationSpeakerCount,
                                                  )
                                        }
                                        onValueChange={(value) => {
                                            const count =
                                                value === "auto"
                                                    ? null
                                                    : Number(value);
                                            handleTranscriptionSettingChange({
                                                diarizationSpeakerCount: count,
                                            });
                                        }}
                                        disabled={disabled}
                                    >
                                        <SettingsSelectTrigger id="diarization-speaker-count">
                                            <SelectValue>
                                                {diarizationSpeakerCount ===
                                                null
                                                    ? "Auto"
                                                    : String(
                                                          diarizationSpeakerCount,
                                                      )}
                                            </SelectValue>
                                        </SettingsSelectTrigger>
                                        <SelectContent align="end">
                                            <SelectItem value="auto">
                                                Auto
                                            </SelectItem>
                                            {Array.from(
                                                { length: 32 },
                                                (_, i) => i + 1,
                                            ).map((count) => (
                                                <SelectItem
                                                    key={count}
                                                    value={String(count)}
                                                >
                                                    {count}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                }
                            />
                        )}
                        <SettingsRow
                            label="Quality"
                            description="Trades speed for accuracy"
                            controlId="transcription-quality"
                            control={
                                <Select
                                    value={transcriptionQuality}
                                    onValueChange={(value) => {
                                        setTranscriptionQuality(value);
                                        handleTranscriptionSettingChange({
                                            transcriptionQuality: value,
                                        });
                                    }}
                                    disabled={disabled}
                                >
                                    <SettingsSelectTrigger id="transcription-quality">
                                        <SelectValue>
                                            {qualityOptions.find(
                                                (opt) =>
                                                    opt.value ===
                                                    transcriptionQuality,
                                            )?.label || "Balanced"}
                                        </SelectValue>
                                    </SettingsSelectTrigger>
                                    <SelectContent align="end">
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
                            }
                        />
                        <ToggleRow
                            id="auto-generate-title"
                            label="Name recordings automatically"
                            description="Writes a title from the transcript with your AI provider"
                            checked={autoGenerateTitle}
                            onCheckedChange={(checked) => {
                                setAutoGenerateTitle(checked);
                                handleTranscriptionSettingChange({
                                    autoGenerateTitle: checked,
                                });
                            }}
                            disabled={disabled}
                        />
                        {autoGenerateTitle && (
                            <ToggleRow
                                id="sync-title-plaud"
                                label="Send titles to Plaud"
                                description="Renames the recording in your Plaud account too"
                                checked={syncTitleToPlaud}
                                onCheckedChange={(checked) => {
                                    setSyncTitleToPlaud(checked);
                                    handleTranscriptionSettingChange({
                                        syncTitleToPlaud: checked,
                                    });
                                }}
                                disabled={disabled}
                            />
                        )}
                    </SettingsRows>

                    <SettingsGroup
                        title="Plaud transcripts"
                        description="For recordings Plaud already transcribed"
                    >
                        <SettingsRows>
                            <ToggleRow
                                id="import-plaud-content"
                                label="Import Plaud transcripts and summaries"
                                description="Brings them in on sync instead of redoing the work with your own provider"
                                checked={importPlaudContent}
                                onCheckedChange={(checked) =>
                                    handleImportSettingChange({
                                        importPlaudContent: checked,
                                    })
                                }
                                disabled={disabled}
                            />
                            {importPlaudContent && (
                                <SettingsRow
                                    label="When Plaud has a transcript"
                                    description="Keeping both also transcribes with your provider so you can compare"
                                    controlId="transcript-mode"
                                    control={
                                        <Select
                                            value={transcriptMode}
                                            onValueChange={(value) =>
                                                handleImportSettingChange({
                                                    transcriptMode: value,
                                                })
                                            }
                                            disabled={disabled}
                                        >
                                            <SettingsSelectTrigger id="transcript-mode">
                                                <SelectValue />
                                            </SettingsSelectTrigger>
                                            <SelectContent align="end">
                                                <SelectItem value="plaud_only">
                                                    Use Plaud only
                                                </SelectItem>
                                                <SelectItem value="keep_both">
                                                    Keep both
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    }
                                />
                            )}
                            {importPlaudContent && (
                                <SettingsRow
                                    label="Primary transcript"
                                    description="Shown first and used for summaries when both exist"
                                    controlId="preferred-transcript-source"
                                    control={
                                        <Select
                                            value={preferredTranscriptSource}
                                            onValueChange={(value) =>
                                                handleImportSettingChange({
                                                    preferredTranscriptSource:
                                                        value,
                                                })
                                            }
                                            disabled={disabled}
                                        >
                                            <SettingsSelectTrigger id="preferred-transcript-source">
                                                <SelectValue />
                                            </SettingsSelectTrigger>
                                            <SelectContent align="end">
                                                <SelectItem value="plaud">
                                                    Plaud
                                                </SelectItem>
                                                <SelectItem value="riffado">
                                                    My provider
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    }
                                />
                            )}
                        </SettingsRows>
                    </SettingsGroup>
                </>
            )}
        </div>
    );
}
