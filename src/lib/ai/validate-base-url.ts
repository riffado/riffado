export const HOSTED_LOCAL_BASE_URL_MESSAGE =
    "We can't reach `localhost` or other private addresses from the hosted app — to use LM Studio or Ollama, self-host Mesynx AI (`docker compose up`).";

export type BaseUrlValidationResult =
    | { ok: true }
    | { ok: false; message: string };

interface ValidateOptions {
    isHosted: boolean;
}

/** Validate an AI provider `baseUrl`. Hosted mode rejects loopback. */
export function validateAiBaseUrl(
    input: string | null | undefined,
    { isHosted }: ValidateOptions,
): BaseUrlValidationResult {
    if (input == null) return { ok: true };
    const trimmed = input.trim();
    if (trimmed === "") return { ok: true };

    if (!isHosted) return { ok: true };

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return {
            ok: false,
            message:
                "Base URL must be a valid absolute URL (e.g. https://api.example.com/v1).",
        };
    }

    let host = parsed.hostname.toLowerCase();
    if (host.startsWith("[") && host.endsWith("]")) {
        host = host.slice(1, -1);
    }
    if (host.endsWith(".")) {
        host = host.slice(0, -1);
    }
    if (isLoopbackOrUnspecified(host)) {
        return { ok: false, message: HOSTED_LOCAL_BASE_URL_MESSAGE };
    }

    return { ok: true };
}

function isLoopbackOrUnspecified(host: string): boolean {
    if (host === "localhost") return true;
    if (host.endsWith(".localhost")) return true;
    if (host === "0.0.0.0") return true;
    if (host === "::1" || host === "::") return true;
    if (host === "0:0:0:0:0:0:0:1" || host === "0:0:0:0:0:0:0:0") return true;
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
        const octets = host.split(".").map(Number);
        if (octets.every((o) => o >= 0 && o <= 255)) return true;
    }
    const v4MappedLoopback = /^::ffff:7[0-9a-f]{1,3}:[0-9a-f]{1,4}$/;
    if (v4MappedLoopback.test(host)) {
        const lastTwoOctets = host.slice("::ffff:".length);
        const [hi] = lastTwoOctets.split(":");
        const hiNum = Number.parseInt(hi, 16);
        if (hiNum >= 0x7f00 && hiNum <= 0x7fff) return true;
    }
    return false;
}
