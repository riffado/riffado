import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Bearer-token gate for the operator-facing `/api/v1/admin/*` surface.
 *
 * This is intentionally separate from `authenticateRequest` (which
 * authenticates a *user* via API key or session): the admin surface
 * has no user behind it — it's the operator's bootstrap mechanism for
 * provisioning new users + minting their API keys, used by
 * integrating systems like meets / ERPnext that want one OpenPlaud
 * user per real human (Modell B in the multi-tenant write-up).
 *
 * Auth model: shared secret in `OPENPLAUD_ADMIN_API_KEY` env var.
 * Caller sends `Authorization: Bearer <that-secret>`. Constant-time
 * comparison via `timingSafeEqual` so a length-mismatch / wrong
 * value can't be distinguished by response timing.
 *
 * If the env var is unset the whole surface is considered disabled —
 * caller gets 503, not 401, so the operator knows the feature wasn't
 * configured rather than thinking they typed the wrong key. 32-char
 * min length is enforced at env-schema level so a typo'd short value
 * can't pass.
 *
 * Returns:
 *   - `{ ok: true }` — caller authenticated
 *   - `{ ok: false, status: 503 }` — provisioning surface disabled
 *   - `{ ok: false, status: 401 }` — header missing or wrong
 */
export type AdminAuthResult =
    | { ok: true }
    | { ok: false; status: 401 | 503; reason: string };

export function authenticateAdminRequest(request: Request): AdminAuthResult {
    const configured = env.OPENPLAUD_ADMIN_API_KEY;
    if (!configured) {
        return {
            ok: false,
            status: 503,
            reason: "Admin provisioning surface is not configured",
        };
    }

    const header = request.headers.get("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) {
        return {
            ok: false,
            status: 401,
            reason: "Missing Authorization: Bearer header",
        };
    }
    const provided = match[1].trim();

    // Length mismatch can't pass timingSafeEqual (it throws on
    // mismatched lengths), so coerce both to fixed-size buffers
    // before comparing. We pad with NULs and then OR-merge the
    // length-check result so the timing of the comparison itself
    // stays constant regardless of which check fails.
    const a = Buffer.from(provided, "utf8");
    const b = Buffer.from(configured, "utf8");
    const maxLen = Math.max(a.length, b.length);
    const padA = Buffer.alloc(maxLen);
    const padB = Buffer.alloc(maxLen);
    a.copy(padA);
    b.copy(padB);
    const equal = timingSafeEqual(padA, padB) && a.length === b.length;
    if (!equal) {
        return {
            ok: false,
            status: 401,
            reason: "Invalid admin bearer token",
        };
    }
    return { ok: true };
}
