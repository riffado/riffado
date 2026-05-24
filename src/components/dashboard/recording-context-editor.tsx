"use client";

import { Check, Info, Pencil, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const CONTEXT_MAX_LEN = 4000;

interface Props {
    recordingId: string;
    initialContext: string | null;
    /**
     * Fires after a successful save so the parent can refresh the
     * recording list — the new context is on `recording.context` for
     * downstream summary re-runs, and the transcription panel surfaces
     * it via the same plumbing.
     */
    onSaved?: (next: string | null) => void;
}

/**
 * Inline context editor surfaced above the transcription panel.
 *
 * The context column on `recordings` carries free-text caller-supplied
 * hints (participants, customer, jargon) that the transcription worker
 * passes to Whisper as a priming `prompt`, and the summary worker
 * prepends to its system message for better speaker attribution. The
 * editor lets a dashboard user supply or correct that context after
 * the fact — e.g. when a sync'd Plaud recording arrives without
 * context, or when the caller's initial value missed a name.
 *
 * Editing the context after a transcript has been generated does NOT
 * automatically re-transcribe; the user has to click "Re-transcribe"
 * for the new context to flow through. Editing before transcribe is
 * the path that benefits most.
 */
export function RecordingContextEditor({
    recordingId,
    initialContext,
    onSaved,
}: Props) {
    const t = useTranslations("recordingContext");
    const tCommon = useTranslations("common");
    const [stored, setStored] = useState<string | null>(initialContext);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(initialContext ?? "");
    const [saving, setSaving] = useState(false);

    // Reset state when switching recordings.
    useEffect(() => {
        setStored(initialContext);
        setDraft(initialContext ?? "");
        setEditing(false);
    }, [recordingId, initialContext]);

    const save = async () => {
        const next = draft.trim();
        if (next.length > CONTEXT_MAX_LEN) {
            toast.error(t("tooLong", { max: CONTEXT_MAX_LEN }));
            return;
        }
        setSaving(true);
        try {
            const res = await fetch(`/api/recordings/${recordingId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ context: next || null }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                toast.error(err.error || t("saveFailed"));
                return;
            }
            const finalValue = next || null;
            setStored(finalValue);
            setEditing(false);
            onSaved?.(finalValue);
            toast.success(t("saved"));
        } catch {
            toast.error(t("saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const cancel = () => {
        setDraft(stored ?? "");
        setEditing(false);
    };

    return (
        <Card>
            <CardContent className="space-y-2 pt-4">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                        <Info
                            className="size-4 text-muted-foreground"
                            aria-hidden="true"
                        />
                        <span>{t("title")}</span>
                    </div>
                    {!editing && (
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(true)}
                            className="-mr-2 h-7 gap-1 px-2 text-xs"
                        >
                            <Pencil className="size-3" aria-hidden="true" />
                            {stored ? tCommon("edit") : t("addButton")}
                        </Button>
                    )}
                </div>

                {editing ? (
                    <div className="space-y-2">
                        <textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            maxLength={CONTEXT_MAX_LEN}
                            placeholder={t("placeholder")}
                            rows={4}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] text-muted-foreground">
                                {draft.length}/{CONTEXT_MAX_LEN}
                            </span>
                            <div className="flex gap-2">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={cancel}
                                    disabled={saving}
                                    className="h-8"
                                >
                                    <X
                                        className="size-3.5 mr-1"
                                        aria-hidden="true"
                                    />
                                    {tCommon("cancel")}
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={save}
                                    disabled={saving}
                                    className="h-8"
                                >
                                    <Check
                                        className="size-3.5 mr-1"
                                        aria-hidden="true"
                                    />
                                    {saving
                                        ? tCommon("saving")
                                        : tCommon("save")}
                                </Button>
                            </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            {t("helpText")}
                        </p>
                    </div>
                ) : stored ? (
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {stored}
                    </p>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {t("emptyHint")}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
