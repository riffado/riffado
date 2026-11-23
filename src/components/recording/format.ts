import {
    differenceInDays,
    format,
    isThisYear,
    isToday,
    isYesterday,
} from "date-fns";
import type { RecordingTranscript } from "@/components/recording/types";
import {
    findPreset,
    isLocalPreset,
    PROVIDER_PRESETS,
} from "@/lib/ai/provider-presets";

/** "Today, 09:12", "Yesterday, 18:40", "Monday, 09:12", "Nov 3, 09:12". */
export function formatRecordedAt(date: Date | string, now: Date): string {
    const d = typeof date === "string" ? new Date(date) : date;
    const time = format(d, "HH:mm");
    if (isToday(d)) return `Today, ${time}`;
    if (isYesterday(d)) return `Yesterday, ${time}`;
    const days = differenceInDays(now, d);
    if (days >= 0 && days < 7) return `${format(d, "EEEE")}, ${time}`;
    return isThisYear(d)
        ? `${format(d, "MMM d")}, ${time}`
        : `${format(d, "MMM d, yyyy")}, ${time}`;
}

/** Duration as people say it: "45 s", "23 min", "1 h 08 min". */
export function formatSpokenDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "0 s";
    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds} s`;
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) return `${totalMinutes} min`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours} h ${minutes.toString().padStart(2, "0")} min`;
}

/**
 * Where a transcript came from, in plain words, or null when we can't
 * say. Never claims "your server" for a cloud provider: only the local
 * presets (Ollama, LM Studio) run next to the Riffado server.
 */
export function transcriptOriginLabel(
    transcript: RecordingTranscript | undefined,
): string | null {
    if (!transcript?.text) return null;
    if (transcript.source === "plaud") return "Imported from Plaud";
    if (transcript.source === "mixed") return "Edited transcript";
    if (
        transcript.transcriptionType === "browser" ||
        transcript.provider === "browser"
    ) {
        return "Transcribed in your browser";
    }
    const provider = transcript.provider;
    if (!provider) return null;
    if (provider === "mynah") return "Transcribed with Mynah";
    if (isLocalPreset(provider)) return "Transcribed on your server";
    const preset = findPreset(provider);
    if (preset && preset.name !== "Custom") {
        return `Transcribed with ${preset.name}`;
    }
    return "Transcribed with your provider";
}

/** Short label for a transcript source in the source switcher. */
export function transcriptSourceLabel(source: string): string {
    if (source === "plaud") return "Plaud";
    if (source === "mixed") return "Edited";
    return "Your provider";
}

/** "English" for "en"; falls back to the code when unknown. */
export function languageName(code: string): string {
    try {
        const names = new Intl.DisplayNames(["en"], { type: "language" });
        return names.of(code) ?? code;
    } catch {
        return code;
    }
}

/** Whitespace-separated word count. */
export function countWords(text: string): number {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * A stored provider name as people know it: "groq" reads "Groq", the
 * same as in "Transcribed with Groq". Unknown names pass through.
 */
export function providerDisplayName(name: string): string {
    const lower = name.toLowerCase();
    if (lower === "mynah") return "Mynah";
    return (
        PROVIDER_PRESETS.find((p) => p.name.toLowerCase() === lower)?.name ??
        name
    );
}
