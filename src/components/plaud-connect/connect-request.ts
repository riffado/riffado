import { parseApiError } from "@/lib/api-errors";
import { buildReportBugUrl } from "@/lib/report-bug";
import { toast } from "@/lib/toast";

/** Why a connect step failed, shown inside the dialog above its buttons. */
export interface ConnectFailure {
    message: string;
    /** Prefilled bug report, when the server attached an error id. */
    reportUrl?: string;
}

/** Reads the API error body of a non-OK response into a dialog message. */
export async function failureFromResponse(
    res: Response,
    fallback: string,
    errorContext: string,
): Promise<ConnectFailure> {
    const body = await parseApiError(res);
    const errorId =
        typeof body.details?.errorId === "string"
            ? body.details.errorId
            : undefined;
    return {
        message: body.error || fallback,
        ...(errorId && {
            reportUrl: buildReportBugUrl({
                errorId,
                errorContext,
                page: window.location.pathname,
            }),
        }),
    };
}

/** A thrown error (network, connector) as a dialog message. */
export function failureFromError(
    err: unknown,
    fallback: string,
): ConnectFailure {
    return { message: err instanceof Error ? err.message : fallback };
}

/** POSTs JSON to one of the Plaud auth routes. */
export function postJson(url: string, body: unknown): Promise<Response> {
    return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

/**
 * The one toast after a connect succeeds, plus the server's warning (for
 * example a short-lived token) when it sent one.
 */
export async function announceConnected(res: Response): Promise<void> {
    toast.success("Plaud account connected");
    const data = (await res.json().catch(() => null)) as {
        warning?: unknown;
    } | null;
    if (typeof data?.warning === "string" && data.warning) {
        toast.warning(data.warning, { duration: 15_000 });
    }
}
