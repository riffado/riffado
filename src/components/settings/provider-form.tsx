"use client";

import type * as React from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
    Checkbox,
    dialogInputClass,
    InfoNote,
    monoInputClass,
} from "@/components/settings/form-controls";
import { credentialsInOrder } from "@/components/settings/provider-actions";
import type { Provider } from "@/components/settings-sections/providers-section";
import { touchTargetClass } from "@/components/ui/button";
import { Field, FieldInput } from "@/components/ui/field";
import {
    isLocalPreset,
    type ProviderPreset,
    supportsEnhancement,
} from "@/lib/ai/provider-presets";
import { cn } from "@/lib/utils";

/** Preset name of the "Another service" choice. */
export const CUSTOM_PRESET = "Custom";

/** Two-letter mark and one-line description for each preset tile. */
const PRESET_TILES: Record<string, { mark: string; description: string }> = {
    OpenAI: { mark: "OA", description: "Whisper and GPT-4o models" },
    Groq: { mark: "GQ", description: "Fast Whisper models" },
    "Together AI": { mark: "TA", description: "Whisper and Parakeet" },
    OpenRouter: { mark: "OR", description: "Many models with one key" },
    "Google Gemini": { mark: "GE", description: "Gemini models" },
    ElevenLabs: { mark: "EL", description: "Scribe. Transcription only" },
    "LM Studio": { mark: "LM", description: "Nothing leaves your network" },
    Ollama: { mark: "OL", description: "Nothing leaves your network" },
};

/** Tile copy for a preset; unknown names get their first two letters. */
export function presetTile(name: string): {
    mark: string;
    description: string;
} {
    return (
        PRESET_TILES[name] ?? {
            mark: name.slice(0, 2).toUpperCase(),
            description: "",
        }
    );
}

/**
 * The add dialog's preset grid: cloud services, then servers you run
 * (hidden on hosted, where the app can't reach them). "Another service"
 * (`Custom`) is its own row and not part of either group.
 */
export function groupPresets(presets: readonly ProviderPreset[]): {
    cloud: ProviderPreset[];
    local: ProviderPreset[];
    custom: ProviderPreset | undefined;
} {
    return {
        cloud: presets.filter(
            (p) => !isLocalPreset(p.name) && p.name !== CUSTOM_PRESET,
        ),
        local: presets.filter((p) => isLocalPreset(p.name)),
        custom: presets.find((p) => p.name === CUSTOM_PRESET),
    };
}

/** An address as people read it: no scheme, no trailing slash. */
export function displayAddress(baseUrl: string): string {
    return baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * The provider that writes summaries and titles, matching
 * `generate-summary`: the flagged default if it can chat, otherwise the
 * oldest provider that can.
 */
export function summariesProviderId(providers: Provider[]): string | undefined {
    const capable = credentialsInOrder(providers).filter((p) =>
        supportsEnhancement(p.provider),
    );
    return (capable.find((p) => p.isDefaultEnhancement) ?? capable[0])?.id;
}

/** Name of the transcription default, if any (a credential or Mynah). */
function transcriptionDefaultName(
    providers: Provider[],
    excludeId?: string,
): string | null {
    const current = providers.find(
        (p) => p.isDefaultTranscription && p.id !== excludeId,
    );
    return current?.provider ?? null;
}

function summariesDefaultName(
    providers: Provider[],
    excludeId?: string,
): string | null {
    const id = summariesProviderId(providers);
    if (!id || id === excludeId) return null;
    return providers.find((p) => p.id === id)?.provider ?? null;
}

/**
 * The line under "Transcription" / "Summaries and titles" in the Use it
 * for list: what ticking (or unticking) the box does to the defaults.
 */
export function defaultChangeLine({
    checked,
    isCurrent,
    otherDefault,
}: {
    checked: boolean;
    /** This provider is the default for this use right now. */
    isCurrent: boolean;
    /** Name of the provider that is the default now, if another one. */
    otherDefault: string | null;
}): string {
    if (isCurrent) return checked ? "Your default" : "Stops being your default";
    if (otherDefault) return `Replaces ${otherDefault} as your default`;
    return "Becomes your default";
}

/**
 * What the confirm dialog says stops working when `provider` is deleted.
 * Transcription falls back to Mynah when the plan includes it; summaries
 * move to the oldest other provider that can write them.
 */
export function providerRemovalCopy(
    provider: Provider,
    providers: Provider[],
): string {
    const transcribes = provider.isDefaultTranscription;
    const summarizes = summariesProviderId(providers) === provider.id;
    const rest = providers.filter((p) => p.id !== provider.id);
    const mynah = rest.find((p) => p.managed === true && p.available);
    const nextSummaries = summariesDefaultName(rest);

    const parts: string[] = [];
    if (transcribes && summarizes && !mynah && !nextSummaries) {
        parts.push(
            "It's your provider for transcription and summaries, so new recordings won't be transcribed or summarized until you choose another one.",
        );
    } else {
        if (transcribes) {
            parts.push(
                mynah
                    ? `It's your provider for transcription, so new recordings go back to ${mynah.provider}.`
                    : "It's your provider for transcription, so new recordings won't be transcribed until you choose another one.",
            );
        }
        if (summarizes) {
            parts.push(
                nextSummaries
                    ? `Summaries and titles move to ${nextSummaries}.`
                    : "It writes your summaries and titles, so new recordings won't get them until you add another provider.",
            );
        }
    }
    if (parts.length === 0) {
        parts.push(
            "It isn't your default for anything, so nothing else changes.",
        );
    }
    return `${parts.join(" ")} Transcripts it already made stay.`;
}

/** Copy for the "What gets sent" note, following the ticked uses. */
export function whatGetsSent({
    transcription,
    summaries,
    onYourServer,
}: {
    transcription: boolean;
    summaries: boolean;
    /** LM Studio, Ollama or another service you point at. */
    onYourServer: boolean;
}): string {
    const what =
        transcription && summaries
            ? "The audio of each recording it transcribes, and transcript text when it writes a summary."
            : transcription
              ? "The audio of each recording it transcribes."
              : summaries
                ? "Transcript text when it writes a summary or title, never audio."
                : "Nothing until you use it for transcription or summaries.";
    const tail = onYourServer
        ? "On your own network, nothing leaves it."
        : "Your key is stored encrypted.";
    return `${what} ${tail}`;
}

/**
 * "Use it for": transcription and summaries as two checkbox rows, each
 * with a line saying what happens to the current default.
 */
export function UseItForRows({
    providerName,
    providers,
    providerId,
    transcription,
    summaries,
    onTranscriptionChange,
    onSummariesChange,
    disabled,
}: {
    providerName: string;
    /** The user's providers, to name the default being replaced. */
    providers: Provider[];
    /** Set when editing a saved provider. */
    providerId?: string;
    transcription: boolean;
    summaries: boolean;
    onTranscriptionChange: (checked: boolean) => void;
    onSummariesChange: (checked: boolean) => void;
    disabled?: boolean;
}) {
    const current = providerId
        ? providers.find((p) => p.id === providerId)
        : undefined;
    const canSummarize = supportsEnhancement(providerName);
    const summariesIsCurrent =
        providerId !== undefined &&
        summariesProviderId(providers) === providerId;
    const summariesLocked =
        summariesIsCurrent &&
        summariesProviderId(
            providers.map((p) =>
                p.id === providerId ? { ...p, isDefaultEnhancement: false } : p,
            ),
        ) === providerId;
    return (
        <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-1.5 text-sm leading-5 font-medium text-strong">
                Use it for
            </legend>
            <div className="squircle flex flex-col divide-y divide-border rounded-[var(--radius-control)] border border-border">
                <UseRow
                    title="Transcription"
                    line={defaultChangeLine({
                        checked: transcription,
                        isCurrent: current?.isDefaultTranscription === true,
                        otherDefault: transcriptionDefaultName(
                            providers,
                            providerId,
                        ),
                    })}
                    checked={transcription}
                    onCheckedChange={onTranscriptionChange}
                    disabled={disabled}
                />
                <UseRow
                    title="Summaries and titles"
                    line={
                        !canSummarize
                            ? `${providerName} transcribes only`
                            : summariesLocked
                              ? "Your default. To change it, pick another provider in the list"
                              : defaultChangeLine({
                                    checked: summaries,
                                    isCurrent: summariesIsCurrent,
                                    otherDefault: summariesDefaultName(
                                        providers,
                                        providerId,
                                    ),
                                })
                    }
                    checked={canSummarize && (summaries || summariesLocked)}
                    onCheckedChange={onSummariesChange}
                    disabled={disabled || !canSummarize || summariesLocked}
                />
            </div>
        </fieldset>
    );
}

function UseRow({
    title,
    line,
    checked,
    onCheckedChange,
    disabled,
}: {
    title: string;
    line: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
}) {
    const id = useId();
    return (
        <label
            htmlFor={id}
            className={cn(
                "flex items-center gap-3 py-3 pr-3 pl-3.5 select-none",
                disabled ? "cursor-default" : "cursor-pointer",
            )}
        >
            <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={(value) => onCheckedChange(value === true)}
                disabled={disabled}
                aria-describedby={`${id}-line`}
            />
            <span
                className={cn(
                    "flex min-w-0 flex-col gap-px",
                    disabled && "opacity-60",
                )}
            >
                <span className="text-ui leading-5 font-medium text-strong">
                    {title}
                </span>
                <span
                    id={`${id}-line`}
                    className="text-xs leading-4 text-muted-foreground"
                >
                    {line}
                </span>
            </span>
        </label>
    );
}

/**
 * A preset's address as a quiet line with Change; Change (or an error on
 * the address) turns it into a field. Empty means the provider's own
 * default endpoint.
 */
export function AddressRow({
    value,
    onChange,
    error,
    hint,
    disabled,
}: {
    value: string;
    onChange: (value: string) => void;
    error?: string | null;
    hint?: React.ReactNode;
    disabled?: boolean;
}) {
    const [editing, setEditing] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const open = editing || Boolean(error);

    useEffect(() => {
        if (error) setEditing(true);
    }, [error]);

    if (!open) {
        return (
            <div className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-small text-muted-foreground">
                    Address
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs leading-4 text-subtle">
                    {value ? displayAddress(value) : "The provider's default"}
                </span>
                <button
                    type="button"
                    onClick={() => {
                        setEditing(true);
                        requestAnimationFrame(() => inputRef.current?.focus());
                    }}
                    disabled={disabled}
                    className={cn(
                        "squircle relative -mr-2 rounded-[var(--radius-small)] px-2 py-1 text-small font-medium text-strong outline-none select-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        touchTargetClass,
                    )}
                >
                    Change
                </button>
            </div>
        );
    }

    return (
        <Field label="Address" error={error ?? undefined} hint={hint}>
            <FieldInput
                ref={inputRef}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://api.example.com/v1"
                value={value}
                disabled={disabled}
                onChange={(e) => onChange(e.target.value)}
                className={cn(dialogInputClass, monoInputClass)}
            />
        </Field>
    );
}

/** The "What gets sent" note for a provider form. */
export function WhatGetsSentNote({
    providerName,
    transcription,
    summaries,
}: {
    providerName: string;
    transcription: boolean;
    summaries: boolean;
}) {
    const onYourServer =
        isLocalPreset(providerName) || providerName === CUSTOM_PRESET;
    return (
        <InfoNote
            title={
                providerName === CUSTOM_PRESET
                    ? "What gets sent to this service"
                    : `What gets sent to ${providerName}`
            }
        >
            {whatGetsSent({ transcription, summaries, onYourServer })}
        </InfoNote>
    );
}
