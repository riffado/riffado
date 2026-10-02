import { env } from "@/lib/env";
import { PENDING_SIGN_IN_TTL_MS } from "./connect";

/** Holds the sealed PKCE/state between "start" and "complete". */
export const CHATGPT_SIGN_IN_COOKIE = "riffado_chatgpt_signin";
export const CHATGPT_SIGN_IN_COOKIE_PATH = "/api/settings/ai/chatgpt";

/**
 * Self-hosted instances often run over plain HTTP on a LAN
 * (http://tower.local:3000). A `Secure` cookie would be dropped there,
 * so follow the configured APP_URL scheme instead of NODE_ENV.
 */
export function signInCookieOptions() {
    return {
        name: CHATGPT_SIGN_IN_COOKIE,
        httpOnly: true,
        secure: (env.APP_URL ?? "").startsWith("https://"),
        sameSite: "lax" as const,
        path: CHATGPT_SIGN_IN_COOKIE_PATH,
        maxAge: Math.floor(PENDING_SIGN_IN_TTL_MS / 1000),
    };
}

export function readCookie(request: Request, name: string): string | null {
    const header = request.headers.get("cookie");
    if (!header) return null;
    for (const part of header.split(";")) {
        const eq = part.indexOf("=");
        if (eq === -1) continue;
        if (part.slice(0, eq).trim() === name) {
            const value = part.slice(eq + 1).trim();
            try {
                return decodeURIComponent(value);
            } catch {
                return value;
            }
        }
    }
    return null;
}
