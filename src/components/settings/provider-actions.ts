import type { Provider } from "@/components/settings-sections/providers-section";
import { isLocalPreset } from "@/lib/ai/provider-presets";
import { getApiErrorMessage } from "@/lib/api-errors";

/** Re-read the provider list (credentials plus the managed provider, if any). */
export async function fetchProviders(): Promise<Provider[]> {
    const response = await fetch("/api/settings/ai/providers");
    if (!response.ok) throw new Error("Failed to fetch providers");
    const data = (await response.json()) as { providers: Provider[] };
    return data.providers;
}

/** Make `providerId` (a credential id or the managed sentinel) the transcription default. */
export async function saveDefaultTranscription(
    providerId: string,
): Promise<void> {
    const res = await fetch(
        "/api/settings/ai/providers/default-transcription",
        {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ providerId }),
        },
    );
    if (!res.ok) {
        throw new Error(
            await getApiErrorMessage(res, "Failed to update default"),
        );
    }
}

/**
 * Make `provider` the one that writes summaries and titles. Goes through
 * the provider update route with the provider's current values, which
 * clears the flag on every other provider in the same transaction.
 */
export async function saveDefaultSummaries(provider: Provider): Promise<void> {
    const res = await fetch(`/api/settings/ai/providers/${provider.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            baseUrl: provider.baseUrl,
            defaultModel: provider.defaultModel,
            isDefaultTranscription: provider.isDefaultTranscription,
            isDefaultEnhancement: true,
        }),
    });
    if (!res.ok) {
        throw new Error(
            await getApiErrorMessage(res, "Failed to update provider"),
        );
    }
}

/** Host of a provider's base URL for display ("api.groq.com"), or null. */
export function providerHost(baseUrl: string | null): string | null {
    if (!baseUrl) return null;
    try {
        return new URL(baseUrl).host;
    } catch {
        return baseUrl;
    }
}

/** One line describing a credential: model and where requests go. */
export function providerSummaryLine(provider: Provider): string | null {
    const parts = [
        provider.defaultModel,
        providerHost(provider.baseUrl),
    ].filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(" · ") : null;
}

/** Local servers (LM Studio, Ollama) get the computer icon, others the key. */
export function isLocalProvider(provider: Provider): boolean {
    return isLocalPreset(provider.provider);
}

/**
 * The user's own providers in the order they were added. The list route
 * has no order, so without this the cards would reshuffle after a save.
 */
export function credentialsInOrder(providers: Provider[]): Provider[] {
    return providers
        .filter((p) => p.managed !== true)
        .sort(
            (a, b) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime(),
        );
}
