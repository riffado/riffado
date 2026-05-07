/**
 * Validates an AI provider `baseUrl` for the current deployment mode.
 *
 * On the hosted instance (`IS_HOSTED=true`) the app process can't reach
 * the user's machine, so loopback / unspecified addresses (localhost,
 * 127.0.0.0/8, 0.0.0.0, ::1, ::) make no sense and silently break AI
 * calls. We reject them at the API layer and surface a short message
 * explaining the user should self-host to use LM Studio / Ollama.
 *
 * On self-host (`IS_HOSTED=false`) every value is allowed — local AI is
 * a first-class path (Ollama, LM Studio, docker-network hostnames).
 */

export const HOSTED_LOCAL_BASE_URL_MESSAGE =
    "We can't reach `localhost` or other private addresses from the hosted app — to use LM Studio or Ollama, self-host OpenPlaud (`docker compose up`).";

export type BaseUrlValidationResult =
    | { ok: true }
    | { ok: false; message: string };

interface ValidateOptions {
    isHosted: boolean;
}

/**
 * @param input  Raw user-supplied base URL. `null`, `undefined`, or empty
 *               string are treated as "no override" and always allowed
 *               (callers fall back to the OpenAI default).
 */
export function validateAiBaseUrl(
    input: string | null | undefined,
    { isHosted }: ValidateOptions,
): BaseUrlValidationResult {
    if (input == null) return { ok: true };
    const trimmed = input.trim();
    if (trimmed === "") return { ok: true };

    // Self-host accepts anything — local AI must keep working.
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

    // URL.hostname keeps brackets for IPv6 literals (`[::1]`); strip them
    // so the loopback check sees the bare address. Also drop any trailing
    // dot — DNS treats `localhost.` as equivalent to `localhost`.
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
    // RFC 6761: `*.localhost` must resolve to loopback. Real-world resolvers
    // honor it; assume the same on hosted.
    if (host.endsWith(".localhost")) return true;
    if (host === "0.0.0.0") return true;
    // IPv6 loopback / unspecified (URL.hostname has stripped brackets).
    if (host === "::1" || host === "::") return true;
    // Some parsers leave the zero-compressed forms; be defensive.
    if (host === "0:0:0:0:0:0:0:1" || host === "0:0:0:0:0:0:0:0") return true;
    // 127.0.0.0/8 — every address in that block is loopback.
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
        const octets = host.split(".").map(Number);
        if (octets.every((o) => o >= 0 && o <= 255)) return true;
    }
    // IPv4-mapped IPv6 (`::ffff:a.b.c.d`). WHATWG URL normalizes the embedded
    // IPv4 to hex (`::ffff:7f00:1`), so check that form. Block the entire
    // `::ffff:` family routed at loopback (`7f00:0000`–`7fff:ffff`).
    const v4MappedLoopback = /^::ffff:7[0-9a-f]{1,3}:[0-9a-f]{1,4}$/;
    if (v4MappedLoopback.test(host)) {
        const lastTwoOctets = host.slice("::ffff:".length); // e.g. "7f00:1"
        const [hi] = lastTwoOctets.split(":");
        const hiNum = Number.parseInt(hi, 16);
        // hi is the high two octets of the embedded IPv4. 0x7f00–0x7fff
        // covers 127.0.0.0/8.
        if (hiNum >= 0x7f00 && hiNum <= 0x7fff) return true;
    }
    return false;
}
