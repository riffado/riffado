"use client";

import { RecordingRowLayout } from "@/components/dashboard/recording-row";
import { formatBytes } from "@/lib/format-bytes";

export interface PendingUpload {
    id: string;
    filename: string;
    filesize: number;
}

export function PendingUploadRow({
    upload,
    isCompact,
}: {
    upload: PendingUpload;
    isCompact: boolean;
}) {
    return (
        <div aria-busy="true">
            <RecordingRowLayout
                tone="working"
                title={upload.filename}
                detail={`Uploading… ${formatBytes(upload.filesize)}`}
                isCompact={isCompact}
            />
        </div>
    );
}
