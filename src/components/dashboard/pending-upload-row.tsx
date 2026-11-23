"use client";

import { RecordingRowLayout } from "@/components/dashboard/recording-row";
import { formatBytes } from "@/lib/format-bytes";

export interface PendingUpload {
    id: string;
    filename: string;
    filesize: number;
    /** `performance.now()` when the upload started. */
    startedAt: number;
    /**
     * The stored recording's filename once the server accepted the
     * upload. The row stays until that recording shows up in the list.
     */
    uploadedAs?: string;
}

export function PendingUploadRow({
    upload,
    isCompact,
}: {
    upload: PendingUpload;
    isCompact: boolean;
}) {
    return (
        <div aria-busy="true" data-flip-key={upload.id} className="select-none">
            <RecordingRowLayout
                tone="working"
                title={upload.filename}
                detail={`Uploading… ${formatBytes(upload.filesize)}`}
                isCompact={isCompact}
            />
        </div>
    );
}
