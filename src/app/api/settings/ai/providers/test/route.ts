import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { testProviderConnection } from "@/lib/ai/test-provider";
import { validateAiBaseUrl } from "@/lib/ai/validate-base-url";
import { requireApiSession } from "@/lib/auth-server";
import { decrypt } from "@/lib/encryption";
import { env } from "@/lib/env";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

/**
 * POST - Probe a provider configuration from the Add/Edit dialog test
 * button, WITHOUT persisting anything.
 *
 * Two modes:
 * - Add dialog (unsaved values): body carries { provider, apiKey,
 *   baseUrl?, defaultModel? } and the key from the form is used for this
 *   one request only.
 * - Edit dialog: body may carry { providerId } instead of an apiKey —
 *   the stored credential is loaded (ownership-scoped), so the test also
 *   works when the key field is left blank (keys are never shown again).
 *   Form values for baseUrl/defaultModel win over the stored ones.
 *
 * Returns: { ok, detail }
 */
export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const { providerId, provider, apiKey, baseUrl, defaultModel } =
        await request.json();

    let resolvedProvider = provider;
    let resolvedApiKey = apiKey;
    let resolvedBaseUrl = baseUrl ?? null;
    let resolvedModel = defaultModel ?? null;

    if (providerId) {
        const [existing] = await db
            .select()
            .from(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.id, providerId),
                    eq(apiCredentials.userId, session.user.id),
                ),
            )
            .limit(1);

        if (!existing) {
            throw new AppError(ErrorCode.NOT_FOUND, "Provider not found", 404);
        }

        resolvedProvider = resolvedProvider || existing.provider;
        resolvedApiKey = resolvedApiKey || decrypt(existing.apiKey);
        resolvedBaseUrl = resolvedBaseUrl ?? existing.baseUrl;
        resolvedModel = resolvedModel ?? existing.defaultModel;
    }

    if (!resolvedProvider || !resolvedApiKey) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "Provider and API key are required",
            400,
        );
    }

    // Same hosted guard as the save routes: a loopback base URL can never
    // work from the hosted app, fail fast with the friendlier message.
    const baseUrlCheck = validateAiBaseUrl(resolvedBaseUrl, {
        isHosted: env.IS_HOSTED,
    });
    if (!baseUrlCheck.ok) {
        throw new AppError(ErrorCode.INVALID_INPUT, baseUrlCheck.message, 400, {
            field: "baseUrl",
        });
    }

    const result = await testProviderConnection({
        provider: resolvedProvider,
        apiKey: resolvedApiKey,
        baseUrl: resolvedBaseUrl,
        defaultModel: resolvedModel,
    });

    return NextResponse.json(result);
});
