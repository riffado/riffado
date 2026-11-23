"use client";

import { useCallback, useRef, useState } from "react";
import type { PendingUpload } from "@/components/dashboard/recording-list";
import { toast } from "@/lib/toast";

interface Options {
    /**
     * Called after a successful upload, with its placeholder (now carrying
     * `uploadedAs`), so the parent can refresh data. The placeholder row
     * stays until the parent calls `settleUpload`, so the list never shows
     * neither row while the refresh is in flight.
     */
    onUploadComplete: (upload: PendingUpload) => void;
    /** Called right before rows are added or removed, so the list can record positions. */
    onBeforeListChange?: () => void;
}

/**
 * Pairs uploaded placeholders with the recordings they became: a recording
 * with the stored filename that wasn't in the library when the upload
 * finished. `baselines` holds those ids, keyed by placeholder id. Each
 * recording is claimed at most once.
 */
export function matchUploadedRecordings<
    R extends { id: string; filename: string },
>(
    uploads: readonly PendingUpload[],
    baselines: ReadonlyMap<string, ReadonlySet<string>>,
    recordings: readonly R[],
): Map<string, R> {
    const matches = new Map<string, R>();
    const claimed = new Set<string>();
    for (const upload of uploads) {
        const known = baselines.get(upload.id);
        if (!upload.uploadedAs || !known) continue;
        const arrived = recordings.find(
            (r) =>
                !known.has(r.id) &&
                !claimed.has(r.id) &&
                r.filename === upload.uploadedAs,
        );
        if (arrived) {
            matches.set(upload.id, arrived);
            claimed.add(arrived.id);
        }
    }
    return matches;
}

/**
 * Audio upload queue: hidden <input type="file"> ref, in-flight flag,
 * optimistic placeholder rows, and the POST. The placeholder rows are
 * surfaced via `pendingUploads` so the recording list can show an
 * "Uploading..." row before the server response lands.
 *
 * The input is wired by attaching `uploadInputRef` to a hidden input
 * and calling `triggerUpload()` from a visible button. The hook also
 * resets `e.target.value` after pickup so picking the same file twice
 * in a row still fires a `change` event.
 */
export function useUploadQueue({
    onUploadComplete,
    onBeforeListChange,
}: Options) {
    const [isUploading, setIsUploading] = useState(false);
    const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
    const uploadInputRef = useRef<HTMLInputElement>(null);

    /** Removes an uploaded placeholder once its recording is in the list. */
    const settleUpload = useCallback((id: string) => {
        setPendingUploads((prev) => prev.filter((p) => p.id !== id));
    }, []);

    const uploadFile = useCallback(
        async (file: File) => {
            // Optimistic placeholder in the list. Uses a `pending:`
            // prefixed id namespace so the row can't collide with a
            // server-issued recording id.
            const placeholder: PendingUpload = {
                id: `pending:${Date.now()}:${Math.random()
                    .toString(36)
                    .slice(2)}`,
                filename: file.name,
                filesize: file.size,
                startedAt: performance.now(),
            };
            onBeforeListChange?.();
            setPendingUploads((prev) => [...prev, placeholder]);

            setIsUploading(true);
            let handedOff = false;
            try {
                const formData = new FormData();
                formData.append("file", file);
                const response = await fetch("/api/recordings/upload", {
                    method: "POST",
                    body: formData,
                });
                if (response.ok) {
                    const data = await response.json();
                    toast.success(`"${data.filename}" uploaded`);
                    const uploaded: PendingUpload = {
                        ...placeholder,
                        uploadedAs: data.filename,
                    };
                    onBeforeListChange?.();
                    setPendingUploads((prev) =>
                        prev.map((p) =>
                            p.id === placeholder.id ? uploaded : p,
                        ),
                    );
                    handedOff = true;
                    onUploadComplete(uploaded);
                } else {
                    const error = await response.json();
                    toast.error(error.error || "Upload failed");
                }
            } catch {
                toast.error("Failed to upload recording");
            } finally {
                setIsUploading(false);
                if (!handedOff) {
                    onBeforeListChange?.();
                    setPendingUploads((prev) =>
                        prev.filter((p) => p.id !== placeholder.id),
                    );
                }
            }
        },
        [onUploadComplete, onBeforeListChange],
    );

    const handleUpload = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;
            // Reset so picking the same file twice still fires change.
            e.target.value = "";
            void uploadFile(file);
        },
        [uploadFile],
    );

    const triggerUpload = useCallback(() => {
        uploadInputRef.current?.click();
    }, []);

    return {
        isUploading,
        pendingUploads,
        settleUpload,
        uploadInputRef,
        handleUpload,
        uploadFile,
        triggerUpload,
    };
}
