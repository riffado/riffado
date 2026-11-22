"use client";

import {
    type BrowserTranscriptionPhase,
    browserPhaseLabel,
    TranscribeInBrowserButton,
} from "@/components/dashboard/transcribe-in-browser-button";
import {
    countWords,
    languageName,
    transcriptSourceLabel,
} from "@/components/recording/format";
import type { RecordingTranscript } from "@/components/recording/types";
import { Button } from "@/components/ui/button";
import { FilterGroup } from "@/components/ui/filter-group";
import { StatusLine } from "@/components/ui/status-dot";

/** One block of transcript: optional timestamp, optional speaker label, text. */
export interface TranscriptBlock {
    time: string | null;
    speaker: string | null;
    text: string;
}

const TIMESTAMP_RE = /^\[(\d{1,2}(?::\d{2}){1,2})\]\s*(.*)$/;
// Only the diarization labels this app emits: `SPEAKER_00` (WhisperX),
// `Speaker 1` (Plaud) and the `UNKNOWN` fallback. A generic `Word:`
// pattern would misread lines like `Question: ...` as speaker turns.
const SPEAKER_RE = /^(SPEAKER_\w+|Speaker\s+\w+|UNKNOWN):\s*(.*)$/;
const SPEAKER_HEADER_RE = /^(Speaker\s+\w+(?:\s+·\s+Part\s+\d+)?)$/;

/**
 * Split a stored transcript into readable blocks. Understands the
 * formats Riffado writes: `[mm:ss] text` lines, `[mm:ss] Speaker 1`
 * headers followed by their text, `SPEAKER_00: text` turns, and plain
 * text (one block per line).
 */
export function parseTranscript(text: string): TranscriptBlock[] {
    const blocks: TranscriptBlock[] = [];
    let continuing = false;
    for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
        const line = raw.trim();
        if (!line) {
            continuing = false;
            continue;
        }
        const stamped = line.match(TIMESTAMP_RE);
        const body = stamped ? stamped[2] : line;
        const header = stamped ? body.match(SPEAKER_HEADER_RE) : null;
        const labeled = body.match(SPEAKER_RE);

        if (header) {
            blocks.push({
                time: stamped?.[1] ?? null,
                speaker: header[1],
                text: "",
            });
            continuing = true;
        } else if (labeled) {
            blocks.push({
                time: stamped?.[1] ?? null,
                speaker: labeled[1],
                text: labeled[2],
            });
            continuing = true;
        } else if (stamped) {
            blocks.push({ time: stamped[1], speaker: null, text: body });
            continuing = true;
        } else if (continuing && blocks.length > 0) {
            const last = blocks[blocks.length - 1];
            last.text = last.text ? `${last.text} ${line}` : line;
        } else {
            blocks.push({ time: null, speaker: null, text: line });
            continuing = false;
        }
    }
    return blocks;
}

interface Props {
    transcripts: RecordingTranscript[];
    active: RecordingTranscript | undefined;
    onSelectSource: (source: string) => void;
    isTranscribing: boolean;
    browserPhase: BrowserTranscriptionPhase;
    browserBusy: boolean;
    onTranscribe: () => void;
    onTranscribeInBrowser: () => void;
}

/** Transcript tab: readable blocks with timestamps, or the way to get one. */
export function RecordingTranscriptTab({
    transcripts,
    active,
    onSelectSource,
    isTranscribing,
    browserPhase,
    browserBusy,
    onTranscribe,
    onTranscribeInBrowser,
}: Props) {
    if (isTranscribing || browserPhase !== "idle") {
        return (
            <StatusLine tone="working" className="text-ui text-subtle">
                {browserPhase !== "idle"
                    ? browserPhaseLabel(browserPhase)
                    : "Transcribing…"}
            </StatusLine>
        );
    }

    if (!active?.text) {
        return (
            <div className="flex flex-col items-start gap-4">
                <p className="text-transcript text-subtle">
                    Not transcribed yet.
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button variant="ink" size="compact" onClick={onTranscribe}>
                        Transcribe
                    </Button>
                    <TranscribeInBrowserButton
                        phase={browserPhase}
                        onStart={onTranscribeInBrowser}
                        disabled={browserBusy}
                    />
                </div>
                <p className="max-w-prose text-small text-muted-foreground">
                    In your browser, the audio stays on this device and no API
                    key is needed. The first run downloads the Whisper model,
                    about 75 MB.
                </p>
            </div>
        );
    }

    const blocks = parseTranscript(active.text);
    const hasTimes = blocks.some((b) => b.time !== null);
    const words = blocks.reduce((sum, b) => sum + countWords(b.text), 0);
    const facts = [
        active.language ? languageName(active.language) : null,
        `${words.toLocaleString("en")} ${words === 1 ? "word" : "words"}`,
    ].filter((f): f is string => f !== null);

    return (
        <div className="flex flex-col gap-6">
            {transcripts.length > 1 ? (
                <FilterGroup
                    aria-label="Transcript source"
                    value={active.source}
                    onValueChange={onSelectSource}
                    options={transcripts.map((t) => ({
                        value: t.source,
                        label: transcriptSourceLabel(t.source),
                    }))}
                />
            ) : null}

            <ol className="flex flex-col gap-4 lg:gap-5">
                {blocks.map((block, i) => (
                    <li
                        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are re-parsed from the text on every render and never reordered
                        key={i}
                        className="flex gap-3 sm:gap-5"
                    >
                        {hasTimes ? (
                            <span className="w-11 shrink-0 pt-1.5 text-small tabular-nums text-muted-foreground select-none sm:w-13">
                                {block.time}
                            </span>
                        ) : null}
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            {block.speaker ? (
                                <span className="pt-1.5 text-small font-semibold text-strong">
                                    {block.speaker}
                                </span>
                            ) : null}
                            {block.text ? (
                                <p className="text-transcript text-foreground">
                                    {block.text}
                                </p>
                            ) : null}
                        </div>
                    </li>
                ))}
            </ol>

            <p className="border-t border-border pt-4 text-small text-muted-foreground">
                {facts.join(" · ")}
            </p>
        </div>
    );
}
