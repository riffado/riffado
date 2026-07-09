import type { ExportJobRow } from "@/db/queries/export-jobs";

export type ClientExportJobStatus =
    | "pending"
    | "processing"
    | "completed"
    | "failed"
    | "expired";

export interface SerializedExportJob {
    id: string;
    status: ClientExportJobStatus;
    createdAt: string;
    completedAt: string | null;
    expiresAt: string | null;
    recordingCount: number | null;
    fileSize: number | null;
    errorMessage: string | null;
}

/**
 * A `completed` row can outlive its retention window if the cleanup
 * worker's storage delete is still retrying after an earlier failure --
 * the row is deliberately kept until the delete actually succeeds (see
 * `selectExpiredExportJobs`), so it isn't lost. Reporting `expired`
 * instead of `completed` here means every client-facing surface (status
 * poll, job list, download gate) agrees on when a backup stops being
 * offered, without needing the row to already be gone.
 */
export function deriveClientStatus(job: ExportJobRow): ClientExportJobStatus {
    const isExpired =
        job.status === "completed" &&
        job.expiresAt !== null &&
        job.expiresAt.getTime() <= Date.now();
    return isExpired ? "expired" : job.status;
}

export function serializeExportJob(job: ExportJobRow): SerializedExportJob {
    return {
        id: job.id,
        status: deriveClientStatus(job),
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt?.toISOString() ?? null,
        expiresAt: job.expiresAt?.toISOString() ?? null,
        recordingCount: job.recordingCount,
        fileSize: job.fileSize,
        errorMessage: job.errorMessage,
    };
}
