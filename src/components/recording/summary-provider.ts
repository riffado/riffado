import type {
    SummaryProviderState,
    TranscriptionProviderState,
} from "@/components/recording/types";
import type { Provider } from "@/components/settings-sections/providers-section";
import { supportsEnhancement } from "@/lib/ai/provider-presets";

/**
 * Whether any provider can write summaries. Mynah (managed) is
 * transcription only, and so are transcription-only presets.
 */
export function summaryProviderStateFor(
    providers: Provider[] | null,
): SummaryProviderState {
    if (providers === null) return "unknown";
    return providers.some((p) => !p.managed && supportsEnhancement(p.provider))
        ? "ready"
        : "missing";
}

/**
 * Whether server transcription has a provider: any of the user's own
 * providers, or Mynah when the current plan can use it. The list only
 * contains Mynah when the instance offers it (hosted), so self-host
 * without a provider reads `missing`.
 */
export function transcriptionProviderStateFor(
    providers: Provider[] | null,
): TranscriptionProviderState {
    if (providers === null) return "unknown";
    return providers.some((p) => !p.managed || p.available !== false)
        ? "ready"
        : "missing";
}
