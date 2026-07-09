import { NextResponse } from "next/server";
import {
    createExportJob,
    EXPORT_COOLDOWN_MS,
    getActiveExportJobForUser,
    getRecentCompletedExportJobForUser,
    listExportJobsForUser,
} from "@/db/queries/export-jobs";
import { requireApiSession } from "@/lib/auth-server";
import { apiHandler } from "@/lib/errors";

function serializeJob(job: {
    id: string;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
    expiresAt: Date | null;
    recordingCount: number | null;
    fileSize: number | null;
    errorMessage: string | null;
}) {
    return {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt?.toISOString() ?? null,
        expiresAt: job.expiresAt?.toISOString() ?? null,
        recordingCount: job.recordingCount,
        fileSize: job.fileSize,
        errorMessage: job.errorMessage,
    };
}

/**
 * Create a full-data export archive job (audio + transcripts + summaries,
 * zipped). Building the archive happens asynchronously in
 * `src/lib/export/worker.ts` -- this only queues the job and returns
 * immediately, so the request never blocks on streaming audio out of
 * storage.
 *
 * Guardrails: at most one active (pending/processing) job per user, and
 * a cooldown against re-requesting right after a completed job -- both
 * enforced here rather than in the worker, since the worker's job is to
 * process the queue, not police who's allowed to add to it.
 */
export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);
    const userId = session.user.id;

    const active = await getActiveExportJobForUser(userId);
    if (active) {
        return NextResponse.json(
            { job: serializeJob(active) },
            { status: 202 },
        );
    }

    const recent = await getRecentCompletedExportJobForUser(userId);
    if (recent) {
        const sinceCompletion = recent.completedAt
            ? Date.now() - recent.completedAt.getTime()
            : Number.POSITIVE_INFINITY;
        if (sinceCompletion < EXPORT_COOLDOWN_MS) {
            return NextResponse.json(
                { job: serializeJob(recent) },
                { status: 200 },
            );
        }
    }

    const job = await createExportJob(userId);
    return NextResponse.json({ job: serializeJob(job) }, { status: 202 });
});

/** List the user's recent export jobs (most recent first, capped at 10). */
export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);
    const jobs = await listExportJobsForUser(session.user.id);
    return NextResponse.json({ jobs: jobs.map(serializeJob) });
});
