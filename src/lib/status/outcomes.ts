import type { CallOutcome, Settled } from "./record";

/**
 * Plaud call outcome. 401 is the user's dead or wrong token and 407 is our
 * own proxy rejecting us: neither says anything about Plaud, so neither is
 * recorded. Server errors, blocks (403), rate limiting, request timeouts
 * and network failures are errors; every other answer (including other
 * 4xx) means Plaud is serving.
 */
export function judgePlaudResponse(settled: Settled<Response>): CallOutcome {
    if (!settled.ok) return "error";
    const status = settled.value.status;
    if (status === 401 || status === 407) return "ignore";
    if (status >= 500 || status === 403 || status === 408 || status === 429) {
        return "error";
    }
    return "ok";
}

/**
 * Mynah call outcome. Our service token being refused (401/403), rate
 * limiting and server errors are errors; other 4xx are a working Mynah
 * rejecting one request.
 */
export function judgeMynahResponse(settled: Settled<Response>): CallOutcome {
    if (!settled.ok) return "error";
    const status = settled.value.status;
    if (status >= 500 || status === 401 || status === 403 || status === 429) {
        return "error";
    }
    return "ok";
}

const STORAGE_NOT_AN_OUTAGE_RE =
    /NoSuchKey|ENOENT|NotFound|not found|does not exist|path traversal|outside storage directory/i;

/** Storage call outcome. A missing object or a rejected key is not a storage outage. */
export function judgeStorageCall<T>(settled: Settled<T>): CallOutcome {
    if (settled.ok) return "ok";
    const message =
        settled.error instanceof Error
            ? settled.error.message
            : String(settled.error);
    return STORAGE_NOT_AN_OUTAGE_RE.test(message) ? "ok" : "error";
}

/**
 * SMTP send outcome. A rejected recipient (RCPT TO, or nodemailer's
 * EENVELOPE) is a bad address, not an email outage.
 */
export function judgeSmtpSend<T>(settled: Settled<T>): CallOutcome {
    if (settled.ok) return "ok";
    const error = settled.error as { code?: unknown; command?: unknown };
    if (error?.command === "RCPT TO" || error?.code === "EENVELOPE") {
        return "ok";
    }
    return "error";
}

/**
 * Auth route outcome. 5xx and thrown errors are errors; 429 is our own
 * rate limit and not recorded; 4xx (wrong password, bad input) is a working
 * sign-in.
 */
export function judgeAuthResponse(settled: Settled<Response>): CallOutcome {
    if (!settled.ok) return "error";
    const status = settled.value.status;
    if (status === 429) return "ignore";
    return status >= 500 ? "error" : "ok";
}
