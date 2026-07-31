export const PLAUD_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const PLAUD_SERVERS = {
    global: {
        label: "Global (api.plaud.ai)",
        description: "Global server — used by most accounts (api.plaud.ai)",
        apiBase: "https://api.plaud.ai",
    },
    eu: {
        label: "EU – Frankfurt (api-euc1.plaud.ai)",
        description:
            "EU server — used by European accounts (api-euc1.plaud.ai)",
        apiBase: "https://api-euc1.plaud.ai",
    },
    apse1: {
        label: "Asia Pacific – Singapore (api-apse1.plaud.ai)",
        description:
            "Asia Pacific server — used by APAC accounts (api-apse1.plaud.ai)",
        apiBase: "https://api-apse1.plaud.ai",
    },
    cn: {
        label: "China Mainland (api.plaud.cn)",
        description:
            "China mainland server — used by accounts registered on web.plaud.cn / app.plaud.cn (api.plaud.cn)",
        apiBase: "https://api.plaud.cn",
    },
    custom: {
        label: "Custom",
        description:
            "Enter a custom Plaud API server URL (e.g. https://api-xxx.plaud.ai)",
        apiBase: "",
    },
} as const;

export type PlaudServerKey = keyof typeof PLAUD_SERVERS;
export const DEFAULT_SERVER_KEY: PlaudServerKey = "global";

/**
 * HTTPS + Plaud-domain check.
 *
 * Accepts both `plaud.ai` (global / EU / APAC) and `plaud.cn` (China
 * mainland). Plaud runs a region-separated China deployment on
 * `api.plaud.cn` / `web.plaud.cn`; accounts registered there do not exist
 * on the `.ai` side at all, so a `.cn` account cannot connect unless this
 * gate admits the domain. The `.cn` deployment is the same backend --
 * `POST /auth/otp-send-code` returns a byte-identical pydantic validation
 * envelope on both hosts -- so no other code path needs to branch on region.
 */
export function isValidPlaudApiUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") return false;
        const host = parsed.hostname;
        return (
            host === "plaud.ai" ||
            host.endsWith(".plaud.ai") ||
            host === "plaud.cn" ||
            host.endsWith(".plaud.cn")
        );
    } catch {
        return false;
    }
}

export function serverKeyFromApiBase(apiBase: string): PlaudServerKey {
    const entry = (
        Object.entries(PLAUD_SERVERS) as [
            PlaudServerKey,
            (typeof PLAUD_SERVERS)[PlaudServerKey],
        ][]
    ).find(([key, s]) => key !== "custom" && s.apiBase === apiBase);
    return entry?.[0] ?? "custom";
}
