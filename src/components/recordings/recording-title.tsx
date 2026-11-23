"use client";

import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getApiErrorMessage } from "@/lib/api-errors";
import {
    MAX_RECORDING_TITLE_LENGTH,
    normalizeRecordingTitle,
} from "@/lib/recordings/filename";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Recording name that renames in place: click (or set `editing`) to
 * edit, Enter or blur to save, Escape to cancel.
 *
 * `variant="display"` wraps long names instead of truncating and drops
 * the pencil hint (the big title has a Rename menu item). Pass
 * `editing` + `onEditingChange` to control edit mode from outside.
 */
export function RecordingTitle({
    recordingId,
    filename,
    onRenamed,
    className,
    variant = "inline",
    editing: editingProp,
    onEditingChange,
}: {
    recordingId: string;
    filename: string;
    onRenamed?: (filename: string) => void;
    className?: string;
    variant?: "inline" | "display";
    editing?: boolean;
    onEditingChange?: (editing: boolean) => void;
}) {
    const [editingState, setEditingState] = useState(false);
    const editing = editingProp ?? editingState;
    const setEditing = (next: boolean) => {
        if (editingProp === undefined) setEditingState(next);
        onEditingChange?.(next);
    };
    const [draft, setDraft] = useState(filename);
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    // Set when editing ends from the keyboard (Enter, Escape), so focus
    // goes back to the title instead of dropping to the page.
    const refocusRef = useRef(false);

    useEffect(() => {
        if (!editing) setDraft(filename);
    }, [filename, editing]);

    useEffect(() => {
        if (!editing) {
            if (refocusRef.current) {
                refocusRef.current = false;
                buttonRef.current?.focus({ preventScroll: true });
            }
            return;
        }
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.select();
    }, [editing]);

    const commit = async () => {
        const next = normalizeRecordingTitle(draft);
        if (!next) {
            toast.error("Name cannot be empty");
            setDraft(filename);
            setEditing(false);
            return;
        }
        if (next.length > MAX_RECORDING_TITLE_LENGTH) {
            refocusRef.current = false;
            toast.error(
                `Name must be ${MAX_RECORDING_TITLE_LENGTH} characters or fewer`,
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
                refocusRef.current = false;
                toast.error(
                    await getApiErrorMessage(response, "Failed to rename"),
                );
                return;
            }
            const body = (await response.json()) as { filename?: string };
            const saved = body.filename ?? next;
            setEditing(false);
            setDraft(saved);
            onRenamed?.(saved);
        } catch {
            refocusRef.current = false;
            toast.error("Failed to rename");
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
                aria-label="Recording name"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                    if (!saving) void commit();
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        if (e.nativeEvent.isComposing) return;
                        e.preventDefault();
                        refocusRef.current = true;
                        void commit();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        refocusRef.current = true;
                        setDraft(filename);
                        setEditing(false);
                    }
                }}
                className={cn(
                    "w-full min-w-0 rounded-md bg-transparent px-1 -mx-1 outline-none",
                    variant === "inline" && "font-semibold",
                    // Chrome won't shrink a text input below the font's
                    // normal line height; pin it to the title's line box.
                    variant === "display" && "block h-[1lh]",
                    "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                    "disabled:opacity-60",
                    className,
                )}
            />
        );
    }

    if (variant === "display") {
        return (
            <button
                ref={buttonRef}
                type="button"
                onClick={() => setEditing(true)}
                title="Rename"
                className={cn(
                    "block w-full rounded-md px-1 -mx-1 text-left wrap-anywhere outline-none transition-colors",
                    "hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    className,
                )}
            >
                {filename}
            </button>
        );
    }

    return (
        <button
            ref={buttonRef}
            type="button"
            onClick={() => setEditing(true)}
            title="Rename"
            aria-label={`Rename ${filename}`}
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
