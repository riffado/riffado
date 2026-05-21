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
    custom: {
        label: "Custom",
        description:
            "Enter a custom Plaud API server URL (e.g. https://api-xxx.plaud.ai)",
        apiBase: "",
    },
} as const;

export type PlaudServerKey = keyof typeof PLAUD_SERVERS;
export const DEFAULT_SERVER_KEY: PlaudServerKey = "global";

/** HTTPS + plaud.ai-subdomain check. */
export function isValidPlaudApiUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return (
            parsed.protocol === "https:" &&
            (parsed.hostname === "plaud.ai" ||
                parsed.hostname.endsWith(".plaud.ai"))
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
