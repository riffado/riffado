import type { SummaryProviderState } from "@/components/recording/types";
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
