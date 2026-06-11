"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PendingUpload {
    id: string;
    filename: string;
    filesize: number;
}

function formatSize(bytes: number) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PendingUploadRow({
    upload,
    rowPadding,
}: {
    upload: PendingUpload;
    rowPadding: string;
}) {
    return (
        <div className={cn("flex items-center gap-3", rowPadding)}>
            <Loader2 className="size-4 animate-spin text-primary" />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-muted-foreground">
                    {upload.filename}
                </p>
                <p className="text-xs text-muted-foreground">
                    Uploading… {formatSize(upload.filesize)}
                </p>
            </div>
        </div>
    );
}
