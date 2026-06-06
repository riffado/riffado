/**
 * Provisioning policy for auto-discovered local AI services.
 *
 * Given the services the scanner found (see `local-discovery.ts`) plus the
 * user's current credentials, decide:
 *   - which to auto-provision (and with what API key + default role),
 *   - which to surface for MANUAL setup (detected but intentionally not
 *     provisioned), and
 *   - what was found overall (for reporting).
 *
 * Pure: no I/O, no mutation of inputs. The route encrypts keys and performs the
 * DB inserts; this module owns only the decision so it can be unit-tested.
 */

import type {
    DiscoveredService,
    DiscoveredServiceType,
} from "@/lib/ai/local-discovery";

/** Documented placeholder key the Faster Whisper server accepts as-is. */
export const WHISPER_PLACEHOLDER_KEY = "sk-placeholder";
/** Fallback key for local OpenAI-compatible backends that ignore the key. */
export const LOCAL_BYPASS_KEY = "local-bypass";

/** Provisioned as the default transcription provider when none exists yet. */
const TRANSCRIPTION_TYPES: ReadonlySet<DiscoveredServiceType> = new Set([
    "Faster Whisper",
    "WhisperX",
]);
/** Provisioned as the default enhancement provider when none exists yet. */
const ENHANCEMENT_TYPES: ReadonlySet<DiscoveredServiceType> = new Set([
    "Ollama",
    "LM Studio",
]);
/**
 * Types we DETECT but never auto-provision. Open WebUI's OpenAI-compatible
 * endpoint requires a real, user-supplied API key (the placeholder won't
 * authenticate), so auto-creating a credential would just yield a dead
 * provider. We report it for manual setup instead.
 */
const MANUAL_ONLY_TYPES: ReadonlySet<DiscoveredServiceType> = new Set([
    "Open WebUI",
]);

export interface ProvisioningInsert {
    type: DiscoveredServiceType;
    baseUrl: string;
    nickname: string;
    /** Plaintext key; the caller encrypts it before persisting. */
    apiKey: string;
    defaultModel: string | null;
    isDefaultTranscription: boolean;
    isDefaultEnhancement: boolean;
}

export interface ProvisioningPlan {
    /** New credentials to insert. */
    inserts: ProvisioningInsert[];
    /** Detected types deliberately left for manual setup (deduped). */
    manual: DiscoveredServiceType[];
    /** Every detected type (deduped) — for reporting. */
    found: DiscoveredServiceType[];
}

export interface ProvisioningContext {
    /** Lower-cased, trimmed baseUrls already configured for the user. */
    existingBaseUrls: ReadonlySet<string>;
    hasDefaultTranscription: boolean;
    hasDefaultEnhancement: boolean;
}

export function planProvisioning(
    services: DiscoveredService[],
    ctx: ProvisioningContext,
): ProvisioningPlan {
    const inserts: ProvisioningInsert[] = [];
    const manual: DiscoveredServiceType[] = [];
    const found: DiscoveredServiceType[] = [];

    // Local working copies so we never mutate the caller's state.
    const seenBaseUrls = new Set(ctx.existingBaseUrls);
    let hasDefaultTranscription = ctx.hasDefaultTranscription;
    let hasDefaultEnhancement = ctx.hasDefaultEnhancement;

    for (const svc of services) {
        found.push(svc.type);

        const baseUrlKey = svc.baseUrl.toLowerCase().trim();
        if (seenBaseUrls.has(baseUrlKey)) continue; // already configured

        if (MANUAL_ONLY_TYPES.has(svc.type)) {
            manual.push(svc.type);
            continue;
        }

        const isDefaultTranscription =
            TRANSCRIPTION_TYPES.has(svc.type) && !hasDefaultTranscription;
        const isDefaultEnhancement =
            ENHANCEMENT_TYPES.has(svc.type) && !hasDefaultEnhancement;
        if (isDefaultTranscription) hasDefaultTranscription = true;
        if (isDefaultEnhancement) hasDefaultEnhancement = true;

        inserts.push({
            type: svc.type,
            baseUrl: svc.baseUrl,
            nickname: `Local ${svc.type} (Auto-detected)`,
            // Faster Whisper and WhisperX ship with a working documented placeholder key;
            // lock it in. Other local backends accept any key.
            apiKey:
                svc.type === "Faster Whisper" || svc.type === "WhisperX"
                    ? WHISPER_PLACEHOLDER_KEY
                    : LOCAL_BYPASS_KEY,
            defaultModel: svc.defaultModel || null,
            isDefaultTranscription,
            isDefaultEnhancement,
        });
        // Guard against two discovered endpoints sharing a baseUrl in one scan.
        seenBaseUrls.add(baseUrlKey);
    }

    return {
        inserts,
        manual: [...new Set(manual)],
        found: [...new Set(found)],
    };
}
