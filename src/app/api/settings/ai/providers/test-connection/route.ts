import { NextResponse } from "next/server";
import { findPreset } from "@/lib/ai/provider-presets";
import { validateAiBaseUrl } from "@/lib/ai/validate-base-url";
import { requireApiSession } from "@/lib/auth-server";
import { env } from "@/lib/env";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

const UPSTREAM_TIMEOUT_MS = 10_000;

export const POST = apiHandler(async (request: Request) => {
    await requireApiSession(request);

    const body = (await request.json().catch(() => null)) as {
        provider?: unknown;
        apiKey?: unknown;
        baseUrl?: unknown;
    } | null;

    const provider = typeof body?.provider === "string" ? body.provider : "";
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey : "";
    const baseUrl = typeof body?.baseUrl === "string" ? body.baseUrl : "";

    if (!provider) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "provider is required",
            400,
        );
    }

    const urlCheck = validateAiBaseUrl(baseUrl, { isHosted: env.IS_HOSTED });
    if (!urlCheck.ok) {
        throw new AppError(ErrorCode.INVALID_INPUT, urlCheck.message, 400, {
            field: "baseUrl",
        });
    }

    const preset = findPreset(provider);
    const effectiveBaseUrl =
        baseUrl || preset?.baseUrl || "https://api.openai.com/v1";

    const modelsUrl = `${effectiveBaseUrl.replace(/\/$/, "")}/models`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    let response: Response;
    try {
        response = await fetch(modelsUrl, {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            signal: controller.signal,
            cache: "no-store",
        });
    } catch (err) {
        if ((err as Error).name === "AbortError") {
            return NextResponse.json(
                {
                    ok: false,
                    message: `Connection timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s. Check that the server is running and the URL is correct.`,
                },
                { status: 200 },
            );
        }
        return NextResponse.json(
            {
                ok: false,
                message: `Could not reach ${effectiveBaseUrl}. Check that the server is running and the URL is correct.`,
            },
            { status: 200 },
        );
    } finally {
        clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
        return NextResponse.json(
            {
                ok: false,
                message:
                    "Server is reachable but rejected the API key (401/403).",
            },
            { status: 200 },
        );
    }

    if (!response.ok) {
        return NextResponse.json(
            {
                ok: false,
                message: `Server returned HTTP ${response.status}. It may not be an OpenAI-compatible API.`,
                models: [],
            },
            { status: 200 },
        );
    }

    const payload = (await response.json().catch(() => null)) as {
        data?: { id: string; owned_by?: string }[];
        models?: { id: string; owned_by?: string }[];
    } | null;

    const rawModels = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
          ? payload.models
          : [];

    const models = rawModels
        .map((m) => ({ id: m.id, name: m.id }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
        ok: true,
        message: `Connection successful. ${models.length} model${models.length === 1 ? "" : "s"} available.`,
        models,
    });
});
