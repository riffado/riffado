"use client";

import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api-errors";
import { uiText } from "@/lib/i18n";
import {
    MAX_RECORDING_TITLE_LENGTH,
    normalizeRecordingTitle,
} from "@/lib/recordings/filename";
import { cn } from "@/lib/utils";

export function RecordingTitle({
    recordingId,
    filename,
    onRenamed,
    className,
}: {
    recordingId: string;
    filename: string;
    onRenamed?: (filename: string) => void;
    className?: string;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(filename);
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!editing) setDraft(filename);
    }, [filename, editing]);

    useEffect(() => {
        if (!editing) return;
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.select();
    }, [editing]);

    const commit = async () => {
        const next = normalizeRecordingTitle(draft);
        if (!next) {
            toast.error(uiText("Name cannot be empty"));
            setDraft(filename);
            setEditing(false);
            return;
        }
        if (next.length > MAX_RECORDING_TITLE_LENGTH) {
            toast.error(
                uiText("Name must be {count} characters or fewer", {
                    count: MAX_RECORDING_TITLE_LENGTH,
                }),
            );
            return;
        }
        if (next === filename) {
            setDraft(filename);
            setEditing(false);
            return;
        }

        setSaving(true);
        try {
            const response = await fetch(`/api/recordings/${recordingId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename: next }),
            });
            if (!response.ok) {
                toast.error(
                    await getApiErrorMessage(
                        response,
                        uiText("Failed to rename"),
                    ),
                );
                return;
            }
            const body = (await response.json()) as { filename?: string };
            const saved = body.filename ?? next;
            setEditing(false);
            setDraft(saved);
            onRenamed?.(saved);
        } catch {
            toast.error(uiText("Failed to rename"));
        } finally {
            setSaving(false);
        }
    };

    if (editing) {
        return (
            <input
                ref={inputRef}
                value={draft}
                disabled={saving}
                maxLength={MAX_RECORDING_TITLE_LENGTH}
                aria-label={uiText("Recording name")}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                    if (!saving) void commit();
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        if (e.nativeEvent.isComposing) return;
                        e.preventDefault();
                        void commit();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        setDraft(filename);
                        setEditing(false);
                    }
                }}
                className={cn(
                    "w-full min-w-0 rounded-md bg-transparent px-1 -mx-1 font-semibold outline-none",
                    "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                    "disabled:opacity-60",
                    className,
                )}
            />
        );
    }

    return (
        <button
            type="button"
            onClick={() => setEditing(true)}
            title={uiText("Rename")}
            aria-label={uiText("Rename {name}", { name: filename })}
            className={cn(
                "group/title inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md text-left",
                "hover:bg-accent/60 focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                "px-1 -mx-1 py-0.5",
            )}
        >
            <span className={cn("truncate", className)}>{filename}</span>
            <Pencil
                className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100"
                aria-hidden="true"
            />
        </button>
    );
}
