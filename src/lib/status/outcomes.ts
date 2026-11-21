import { isPlaudApiHost } from "@/lib/plaud/servers";
import {
    isObjectMissingShape,
    isStorageRootMissingShape,
    type StorageErrorShape,
    storageErrorChain,
} from "@/lib/storage/errors";
import type { CallOutcome, Settled } from "./record";

/** The URL of a judged Plaud request. */
export interface PlaudRequestInfo {
    url: string;
}

/**
 * Plaud call outcome. 401 is the user's dead or wrong token and 407 is our
 * own proxy rejecting us: neither says anything about Plaud, so neither is
 * recorded. A 403 is an error when a Plaud API host answered it, directly
 * or as the final answer after proxy rotation, since sync is then blocked;
 * from a presigned storage host it is an expired link and is ignored.
 * Server errors, rate limiting, request timeouts and network failures are
 * errors; every other answer (including other 4xx) means Plaud is serving.
 */
export function judgePlaudResponse(
    settled: Settled<Response>,
    request: PlaudRequestInfo,
): CallOutcome {
    if (!settled.ok) return "error";
    const status = settled.value.status;
    if (status === 401 || status === 407) return "ignore";
    if (status === 403) {
        return isPlaudApiHost(request.url) ? "error" : "ignore";
    }
    if (status >= 500 || status === 408 || status === 429) {
        return "error";
    }
    return "ok";
}

/**
 * Mynah call outcome. Our service token being refused (401/403), a missing
 * route (404, since the endpoint path is fixed), request timeouts (408),
 * rate limiting and server errors are errors; other 4xx are a working
 * Mynah rejecting one request.
 */
export function judgeMynahResponse(settled: Settled<Response>): CallOutcome {
    if (!settled.ok) return "error";
    const status = settled.value.status;
    if (
        status >= 500 ||
        status === 401 ||
        status === 403 ||
        status === 404 ||
        status === 408 ||
        status === 429
    ) {
        return "error";
    }
    return "ok";
}

/**
 * Which kind of storage call is judged. "key" calls (download, exists,
 * delete) may legitimately find no object; "write" calls may not.
 */
export type StorageCallKind = "key" | "write";

function isRejectedKey(error: StorageErrorShape): boolean {
    return (
        typeof error.message === "string" &&
        error.message.startsWith("Invalid file key:")
    );
}

/**
 * Storage call outcome, judged on the error's identity along its `cause`
 * chain. A missing object (S3 NoSuchKey/NotFound/404, local ENOENT) on a
 * "key" call and a rejected key are ignored. A missing bucket
 * (NoSuchBucket), a missing local base directory and everything else are
 * errors.
 */
export function judgeStorageCall(kind: StorageCallKind) {
    return <T>(settled: Settled<T>): CallOutcome => {
        if (settled.ok) return "ok";
        const chain = storageErrorChain(settled.error);
        if (chain.some(isStorageRootMissingShape)) return "error";
        if (chain.some(isRejectedKey)) return "ignore";
        if (kind === "key" && chain.some(isObjectMissingShape)) return "ignore";
        return "error";
    };
}

interface SmtpErrorShape {
    code?: unknown;
    command?: unknown;
    responseCode?: unknown;
    rejectedErrors?: unknown;
}

function isPermanentRecipientRejection(error: unknown): boolean {
    if (error === null || typeof error !== "object") return false;
    const { command, responseCode } = error as SmtpErrorShape;
    return (
        command === "RCPT TO" &&
        typeof responseCode === "number" &&
        responseCode >= 500 &&
        responseCode < 600
    );
}

/**
 * Whether an SMTP send error is a permanent recipient rejection: a 5xx
 * answer to RCPT TO for every recipient, as nodemailer's EENVELOPE lists
 * them. A refused sender, temporary (4xx) rejections, connection errors and
 * everything else are not.
 */
export function isPermanentSmtpRejection(error: unknown): boolean {
    if (!isPermanentRecipientRejection(error)) return false;
    const { code, rejectedErrors } = error as SmtpErrorShape;
    if (code !== "EENVELOPE") return true;
    return (
        Array.isArray(rejectedErrors) &&
        rejectedErrors.length > 0 &&
        rejectedErrors.every(isPermanentRecipientRejection)
    );
}

/**
 * SMTP send outcome. Only a permanent recipient rejection is a bad address
 * rather than an email outage; everything else that failed is an error.
 */
export function judgeSmtpSend<T>(settled: Settled<T>): CallOutcome {
    if (settled.ok) return "ok";
    return isPermanentSmtpRejection(settled.error) ? "ok" : "error";
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
