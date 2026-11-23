import type { PlaudServerKey } from "@/lib/plaud/servers";

const SHORT_LABELS: Record<Exclude<PlaudServerKey, "custom">, string> = {
    global: "Plaud global",
    eu: "Plaud EU",
    apse1: "Plaud Asia Pacific",
    cn: "Plaud China",
};

function hostOf(apiBase: string | undefined): string | null {
    if (!apiBase) return null;
    try {
        return new URL(apiBase).host;
    } catch {
        return apiBase;
    }
}

/**
 * Short name of the Plaud server an account lives on, for the settings
 * card ("Plaud EU"). A custom server shows its host, since that is the
 * one thing its owner needs to recognise.
 */
export function plaudServerName(
    server: PlaudServerKey | undefined,
    apiBase?: string,
): string {
    if (!server) return "Unknown";
    if (server === "custom") return hostOf(apiBase) ?? "Custom server";
    return SHORT_LABELS[server];
}

/** The same name as a phrase ("Plaud EU server"), for running text. */
export function plaudServerPhrase(
    server: PlaudServerKey | undefined,
    apiBase?: string,
): string | null {
    if (!server) return null;
    if (server === "custom") return hostOf(apiBase) ?? "Custom server";
    return `${SHORT_LABELS[server]} server`;
}

/** Region shown next to an email code ("EU (Frankfurt)"). */
export function plaudRegionFromApiBase(apiBase: string): string {
    if (apiBase.includes("euc1")) return "EU (Frankfurt)";
    if (apiBase.includes("apse1")) return "Asia Pacific (Singapore)";
    if (apiBase.includes("api.plaud.cn")) return "China Mainland";
    if (apiBase.includes("api.plaud.ai")) return "Global";
    return apiBase;
}
