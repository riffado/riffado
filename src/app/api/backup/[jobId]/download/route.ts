import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getExportJobForUser } from "@/db/queries/export-jobs";
import { requireApiSession } from "@/lib/auth-server";
import { env } from "@/lib/env";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { createStorageProvider } from "@/lib/storage/factory";

type IdContext = { params: Promise<{ jobId: string }> };

const SIGNED_URL_TTL_SECONDS = 5 * 60;

/**
 * Serves the finished archive. On S3-backed instances this 307-redirects
 * to a short-lived signed URL so the archive's bytes flow straight from
 * the object store to the browser -- the app server never touches them.
 * Local storage has no separate object-store endpoint to redirect to, so
 * this streams the file through the app server directly; that's fine for
 * the self-host, typically-single-user case this backend targets.
 */
export const GET = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { jobId } = await (context as IdContext).params;

    const job = await getExportJobForUser(jobId, session.user.id);
    if (!job) {
        throw new AppError(ErrorCode.NOT_FOUND, "Export job not found", 404);
    }
    if (job.status !== "completed" || !job.storageKey) {
        throw new AppError(
            ErrorCode.CONFLICT,
            "Export is not ready for download",
            409,
        );
    }

    const storage = createStorageProvider();
    const filename = `riffado-export-${job.id}.zip`;

    if (env.DEFAULT_STORAGE_TYPE === "s3") {
        const url = await storage.getSignedUrl(
            job.storageKey,
            SIGNED_URL_TTL_SECONDS,
        );
        return NextResponse.redirect(url, 307);
    }

    const stream = await storage.downloadStream(job.storageKey);
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
        headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${filename}"`,
            ...(job.fileSize ? { "Content-Length": String(job.fileSize) } : {}),
        },
    });
});
