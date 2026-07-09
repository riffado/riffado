import { NextResponse } from "next/server";
import { getExportJobForUser } from "@/db/queries/export-jobs";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

type IdContext = { params: Promise<{ jobId: string }> };

/**
 * Poll a single export job's status. Actual downloading happens at
 * `GET /api/backup/[jobId]/download` (browser navigation, not this
 * JSON endpoint) so the archive bytes never need to round-trip through
 * client-side JS.
 */
export const GET = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { jobId } = await (context as IdContext).params;

    const job = await getExportJobForUser(jobId, session.user.id);
    if (!job) {
        throw new AppError(ErrorCode.NOT_FOUND, "Export job not found", 404);
    }

    return NextResponse.json({
        job: {
            id: job.id,
            status: job.status,
            createdAt: job.createdAt.toISOString(),
            completedAt: job.completedAt?.toISOString() ?? null,
            expiresAt: job.expiresAt?.toISOString() ?? null,
            recordingCount: job.recordingCount,
            fileSize: job.fileSize,
            errorMessage: job.errorMessage,
        },
    });
});
