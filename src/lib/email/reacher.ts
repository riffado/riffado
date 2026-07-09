import { env } from "@/lib/env";

export type Reachable = "safe" | "risky" | "invalid" | "unknown";

export interface ReacherResult {
    email: string;
    reachable: Reachable;
    isDisposable: boolean;
    isRoleAccount: boolean;
    hasFullInbox: boolean;
    isCatchAll: boolean;
    mxAccepts: boolean;
    raw: unknown;
}

interface ReacherRawResponse {
    input?: string;
    is_reachable?: string;
    misc?: {
        is_disposable?: boolean;
        is_role_account?: boolean;
    } | null;
    mx?: {
        accepts_mail?: boolean;
        records?: string[];
    } | null;
    smtp?: {
        has_full_inbox?: boolean;
        is_catch_all?: boolean;
        is_deliverable?: boolean;
        is_disabled?: boolean;
    } | null;
}

function normalizeReachable(value: unknown): Reachable {
    if (value === "safe" || value === "risky" || value === "invalid") {
        return value;
    }
    return "unknown";
}

function parseReacherBody(
    input: string,
    body: ReacherRawResponse,
): ReacherResult {
    return {
        email: body.input ?? input,
        reachable: normalizeReachable(body.is_reachable),
        isDisposable: body.misc?.is_disposable === true,
        isRoleAccount: body.misc?.is_role_account === true,
        hasFullInbox: body.smtp?.has_full_inbox === true,
        isCatchAll: body.smtp?.is_catch_all === true,
        mxAccepts: body.mx?.accepts_mail === true,
        raw: body,
    };
}

export class ReacherNotConfiguredError extends Error {
    constructor() {
        super(
            "Reacher is not configured (REACHER_API_KEY unset). Validation skipped.",
        );
        this.name = "ReacherNotConfiguredError";
    }
}

export class ReacherRequestError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly body: string,
    ) {
        super(message);
        this.name = "ReacherRequestError";
    }
}

/** True iff Reacher is configured for this instance. */
export function isReacherConfigured(): boolean {
    return Boolean(env.REACHER_API_KEY);
}

/**
 * Verify a single email address via Reacher. Throws
 * `ReacherNotConfiguredError` if the API key is unset (branch on
 * `isReacherConfigured()` instead of catching).
 */
export async function checkEmail(
    email: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ReacherResult> {
    const apiKey = env.REACHER_API_KEY;
    if (!apiKey) throw new ReacherNotConfiguredError();

    const url = env.REACHER_API_URL;
    const timeoutMs = options.timeoutMs ?? 30_000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (options.signal) {
        if (options.signal.aborted) {
            clearTimeout(timeoutId);
            controller.abort();
        } else {
            options.signal.addEventListener("abort", () => controller.abort(), {
                once: true,
            });
        }
    }

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ to_email: email }),
            signal: controller.signal,
        });

        const text = await response.text();
        if (!response.ok) {
            throw new ReacherRequestError(
                `Reacher returned ${response.status}`,
                response.status,
                text,
            );
        }

        let parsed: ReacherRawResponse;
        try {
            parsed = JSON.parse(text) as ReacherRawResponse;
        } catch (cause) {
            throw new ReacherRequestError(
                `Reacher returned non-JSON response: ${(cause as Error).message}`,
                response.status,
                text,
            );
        }

        return parseReacherBody(email, parsed);
    } finally {
        clearTimeout(timeoutId);
    }
}
