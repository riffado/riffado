/**
 * POST /api/settings/ai/providers/models
 *
 * Fetches the list of audio-input-capable models from a provider, so the
 * Add/Edit dialogs can offer a dropdown instead of forcing the user to
 * paste a model id they may not have on hand. Powering the OpenRouter
 * happy path for issue #122.
 *
 * Request body: `{ provider, apiKey, baseUrl? }`. The apiKey is taken from
 * the in-progress form (the credential may not be saved yet), validated
 * via a single upstream call, and never persisted from this route.
 *
 * Currently only OpenRouter exposes per-model `input_modalities`. Other
 * presets return an empty list and the UI falls back to the freeform
 * text input. The route is intentionally generic so other providers can
 * be added (Together AI, Groq) without a new endpoint shape.
 */

import { NextResponse } from "next/server";
import { findPreset } from "@/lib/ai/provider-presets";
import { validateAiBaseUrl } from "@/lib/ai/validate-base-url";
import { requireApiSession } from "@/lib/auth-server";
import { env } from "@/lib/env";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

interface ModelOption {
    id: string;
    name: string;
}

interface OpenRouterModel {
    id: string;
    name?: string;
    architecture?: {
        input_modalities?: string[];
    };
}

const UPSTREAM_TIMEOUT_MS = 10_000;

export const POST = apiHandler(async (request: Request) => {
    // Auth-only: we never read or write user-scoped DB rows here, but the
    // route proxies an outbound HTTP call using a user-supplied key. Gate
    // it behind a session so anonymous traffic can't burn our egress.
    await requireApiSession(request);

    const body = (await request.json().catch(() => null)) as {
        provider?: unknown;
        apiKey?: unknown;
        baseUrl?: unknown;
    } | null;

    const provider = typeof body?.provider === "string" ? body.provider : "";
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey : "";
    const baseUrl = typeof body?.baseUrl === "string" ? body.baseUrl : "";

    if (!provider || !apiKey) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "provider and apiKey are required",
            400,
        );
    }

    // Same hosted-mode loopback guard the credential routes apply, so the
    // hosted app process can't be tricked into probing internal endpoints
    // via a crafted baseUrl.
    const urlCheck = validateAiBaseUrl(baseUrl, { isHosted: env.IS_HOSTED });
    if (!urlCheck.ok) {
        throw new AppError(ErrorCode.INVALID_INPUT, urlCheck.message, 400, {
            field: "baseUrl",
        });
    }

    const preset = findPreset(provider);
    const effectiveBaseUrl =
        baseUrl || preset?.baseUrl || "https://api.openai.com/v1";

    if (provider === "OpenRouter") {
        const models = await fetchOpenRouterAudioModels(
            effectiveBaseUrl,
            apiKey,
        );
        return NextResponse.json({ models });
    }

    // For every other preset we don't have a reliable capability tag.
    // Return empty and let the UI fall back to the freeform input.
    return NextResponse.json({ models: [] satisfies ModelOption[] });
});

async function fetchOpenRouterAudioModels(
    baseUrl: string,
    apiKey: string,
): Promise<ModelOption[]> {
    const url = `${baseUrl.replace(/\/$/, "")}/models`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    let response: Response;
    try {
        response = await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: controller.signal,
        });
    } catch (err) {
        if ((err as Error).name === "AbortError") {
            throw new AppError(
                ErrorCode.AI_PROVIDER_API_ERROR,
                "Timed out fetching models from OpenRouter.",
                504,
            );
        }
        throw new AppError(
            ErrorCode.AI_PROVIDER_API_ERROR,
            "Failed to reach OpenRouter.",
            502,
        );
    } finally {
        clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
        throw new AppError(
            ErrorCode.AI_PROVIDER_API_ERROR,
            "OpenRouter rejected the API key.",
            401,
        );
    }
    if (!response.ok) {
        throw new AppError(
            ErrorCode.AI_PROVIDER_API_ERROR,
            `OpenRouter returned ${response.status} while listing models.`,
            502,
        );
    }

    const payload = (await response.json().catch(() => null)) as {
        data?: OpenRouterModel[];
    } | null;
    const list = Array.isArray(payload?.data) ? payload.data : [];

    const models: ModelOption[] = list
        .filter((m) =>
            (m.architecture?.input_modalities ?? []).includes("audio"),
        )
        .map((m) => ({ id: m.id, name: m.name || m.id }))
        // Stable alphabetical order so the dropdown doesn't reshuffle on
        // every refresh as OpenRouter's catalog re-orders.
        .sort((a, b) => a.name.localeCompare(b.name));

    return models;
}
