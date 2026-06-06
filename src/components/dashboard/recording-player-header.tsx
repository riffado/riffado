"use client";

import { AudioWaveform, Check, Loader2, Pencil, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { CardHeader } from "@/components/ui/card";
import { formatBytes } from "@/lib/format-bytes";
import { formatDateTime } from "@/lib/format-date";
import { formatDuration } from "@/lib/format-duration";
import type { Recording } from "@/types/recording";

interface Props {
    recording: Recording;
    duration: number;
    scrubberStyle: "waveform" | "slider";
    waveformStatus: "idle" | "ready" | "decoding" | "skipped" | "error";
    onDecodeWaveform: () => void;
    onTitleChange?: (newTitle: string) => void;
}

export function RecordingPlayerHeader({
    recording,
    duration,
    scrubberStyle,
    waveformStatus,
    onDecodeWaveform,
    onTitleChange,
}: Props) {
    const metaParts: string[] = [
        formatDateTime(recording.startTime, "relative"),
        formatDuration(duration || recording.duration / 1000),
        formatBytes(recording.filesize),
    ];

    // ── Inline title editing ─────────────────────────────────────
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const startEdit = useCallback(() => {
        setEditValue(recording.filename);
        setEditing(true);
        setTimeout(() => {
            inputRef.current?.select();
        }, 30);
    }, [recording.filename]);

    const cancelEdit = useCallback(() => {
        setEditing(false);
        setEditValue("");
    }, []);

    const commitEdit = useCallback(async () => {
        const trimmed = editValue.trim();
        if (!trimmed || trimmed === recording.filename) {
            cancelEdit();
            return;
        }
        setIsSaving(true);
        try {
            const res = await fetch(`/api/recordings/${recording.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename: trimmed }),
            });
            if (!res.ok) throw new Error("Failed");
            onTitleChange?.(trimmed);
            setEditing(false);
        } catch {
            toast.error("Couldn't save title — please try again.");
        } finally {
            setIsSaving(false);
        }
    }, [editValue, recording, cancelEdit, onTitleChange]);

    return (
        <CardHeader className="gap-1.5 pb-4">
            {editing ? (
                <div className="flex items-center gap-1.5">
                    <input
                        ref={inputRef}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                void commitEdit();
                            } else if (e.key === "Escape") {
                                cancelEdit();
                            }
                        }}
                        onBlur={() => void commitEdit()}
                        disabled={isSaving}
                        className="min-w-0 flex-1 rounded border border-primary/40 bg-background px-2 py-1 text-base font-semibold outline-none ring-1 ring-primary/30 focus:ring-primary leading-tight"
                        autoComplete="off"
                    />
                    {isSaving ? (
                        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                        <>
                            <button
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    void commitEdit();
                                }}
                                className="shrink-0 text-primary hover:text-primary/80"
                            >
                                <Check className="size-4" />
                            </button>
                            <button
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    cancelEdit();
                                }}
                                className="shrink-0 text-muted-foreground hover:text-foreground"
                            >
                                <X className="size-4" />
                            </button>
                        </>
                    )}
                </div>
            ) : (
                <button
                    type="button"
                    onClick={startEdit}
                    title="Click to rename"
                    className="group/title flex items-center gap-1.5 text-left"
                >
                    <h2 className="truncate text-base font-semibold leading-tight text-foreground group-hover/title:text-primary transition-colors">
                        {recording.filename}
                    </h2>
                    <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover/title:opacity-100 transition-opacity" />
                </button>
            )}

            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground font-mono">
                {metaParts.map((part, i) => (
                    <span
                        key={part}
                        className="inline-flex items-center gap-1.5"
                    >
                        {i > 0 && (
                            <span aria-hidden="true" className="opacity-30">
                                ·
                            </span>
                        )}
                        <span>{part}</span>
                    </span>
                ))}
                {scrubberStyle === "waveform" &&
                    waveformStatus === "decoding" && (
                        <span className="inline-flex items-center gap-1 text-primary/70">
                            <span aria-hidden="true" className="opacity-30">
                                ·
                            </span>
                            <Loader2 className="size-2.5 animate-spin" />
                            Analyzing…
                        </span>
                    )}
                {scrubberStyle === "waveform" &&
                    waveformStatus === "skipped" && (
                        <button
                            type="button"
                            onClick={onDecodeWaveform}
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
                            title="Decode waveform in your browser"
                        >
                            <span aria-hidden="true" className="opacity-30">
                                ·
                            </span>
                            <AudioWaveform className="size-2.5" />
                            Generate waveform
                        </button>
                    )}
                {scrubberStyle === "waveform" && waveformStatus === "error" && (
                    <button
                        type="button"
                        onClick={onDecodeWaveform}
                        className="inline-flex items-center gap-1 text-destructive hover:underline underline-offset-2 transition-colors"
                    >
                        <span aria-hidden="true" className="opacity-30">
                            ·
                        </span>
                        <AudioWaveform className="size-2.5" />
                        Retry waveform
                    </button>
                )}
            </div>
        </CardHeader>
    );
}
