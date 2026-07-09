import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { setDefaultTranscriptionProvider } from "@/lib/ai/set-default-transcription";
import { requireApiSession } from "@/lib/auth-server";
import { getEntitlements } from "@/lib/entitlements";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { isMynahConfigured } from "@/lib/hosted/transcription/mynah";
import {
    isRiffadoIncludedProviderId,
    RIFFADO_INCLUDED_PROVIDER_LABEL,
} from "@/lib/transcription/included-provider";

const bodySchema = z.object({
    providerId: z.string().min(1),
});

export const PUT = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "Invalid request body",
            400,
            { issues: parsed.error.flatten() },
        );
    }

    const { providerId } = parsed.data;

    if (isRiffadoIncludedProviderId(providerId)) {
        if (!isMynahConfigured()) {
            throw new AppError(
                ErrorCode.CONFLICT,
                `${RIFFADO_INCLUDED_PROVIDER_LABEL} is not available on this instance`,
                403,
            );
        }

        const entitlements = await getEntitlements(session.user.id);
        if (entitlements.monthlyMynahSeconds <= 0) {
            throw new AppError(
                ErrorCode.FORBIDDEN,
                "Your current plan does not include Riffado transcription",
                403,
            );
        }
    } else {
        const [provider] = await db
            .select({ id: apiCredentials.id })
            .from(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.id, providerId),
                    eq(apiCredentials.userId, session.user.id),
                ),
            )
            .limit(1);

        if (!provider) {
            throw new AppError(ErrorCode.NOT_FOUND, "Provider not found", 404);
        }
    }

    await setDefaultTranscriptionProvider(session.user.id, providerId);

    return NextResponse.json({ success: true });
});
