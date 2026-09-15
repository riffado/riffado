"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { PendingUpload } from "@/components/dashboard/recording-list";
import { uiText } from "@/lib/i18n";
import { uiError } from "@/lib/i18n/errors";

interface Options {
    /** Called after a successful upload so the parent can refresh data. */
    onUploadComplete: () => void;
}

/**
 * Audio upload queue: hidden <input type="file"> ref, in-flight flag,
 * optimistic placeholder rows, and the POST. The placeholder rows are
 * surfaced via `pendingUploads` so the recording list can show a
 * "Uploading..." row before the server response lands.
 *
 * The input is wired by attaching `uploadInputRef` to a hidden input
 * and calling `triggerUpload()` from a visible button. The hook also
 * resets `e.target.value` after pickup so picking the same file twice
 * in a row still fires a `change` event.
 */
export function useUploadQueue({ onUploadComplete }: Options) {
    const [isUploading, setIsUploading] = useState(false);
    const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
    const uploadInputRef = useRef<HTMLInputElement>(null);

    const handleUpload = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;
            // Reset so picking the same file twice still fires change.
            e.target.value = "";

            // Optimistic placeholder in the list. Uses a `pending:`
            // prefixed id namespace so the row can't collide with a
            // server-issued recording id.
            const placeholderId = `pending:${Date.now()}:${Math.random()
                .toString(36)
                .slice(2)}`;
            setPendingUploads((prev) => [
                ...prev,
                {
                    id: placeholderId,
                    filename: file.name,
                    filesize: file.size,
                },
            ]);

            setIsUploading(true);
            try {
                const formData = new FormData();
                formData.append("file", file);
                const response = await fetch("/api/recordings/upload", {
                    method: "POST",
                    body: formData,
                });
                if (response.ok) {
                    const data = await response.json();
                    toast.success(
                        uiText('"{name}" uploaded', { name: data.filename }),
                    );
                    onUploadComplete();
                } else {
                    const error = await response.json();
                    toast.error(
                        uiError(
                            error.error || uiText("Upload failed"),
                            error.code,
                        ),
                    );
                }
            } catch {
                toast.error(uiText("Failed to upload recording"));
            } finally {
                setIsUploading(false);
                setPendingUploads((prev) =>
                    prev.filter((p) => p.id !== placeholderId),
                );
            }
        },
        [onUploadComplete],
    );

    const triggerUpload = useCallback(() => {
        uploadInputRef.current?.click();
    }, []);

    return {
        isUploading,
        pendingUploads,
        uploadInputRef,
        handleUpload,
        triggerUpload,
    };
}
