import { toast } from "sonner";
import type { ErrorCode } from "@/lib/errors";
import { uiText } from "@/lib/i18n";
import { uiError } from "@/lib/i18n/errors";
import { buildReportBugUrl } from "@/lib/report-bug";

export interface ApiErrorBody {
    error: string;
    code: ErrorCode | string;
    details?: Record<string, unknown>;
}

export async function parseApiError(response: Response): Promise<ApiErrorBody> {
    try {
        const body = (await response.json()) as Partial<ApiErrorBody>;
        if (
            body &&
            typeof body.error === "string" &&
            typeof body.code === "string"
        ) {
            return {
                error: body.error,
                code: body.code,
                ...(body.details && { details: body.details }),
            };
        }
    } catch {}
    return {
        error: response.statusText || "Request failed",
        code: "UNKNOWN_ERROR",
    };
}

export async function getApiErrorMessage(
    response: Response,
    fallback = uiText("Request failed"),
): Promise<string> {
    const body = await parseApiError(response);
    return uiError(body.error || fallback, body.code);
}

export interface ToastApiErrorOptions {
    fallback?: string;
    errorContext?: string;
}

/** Toast a non-OK response; attaches a "Report" action when an `errorId` is present. */
export async function toastApiError(
    response: Response,
    opts: ToastApiErrorOptions = {},
): Promise<ApiErrorBody> {
    const body = await parseApiError(response);
    const message = uiError(
        body.error || opts.fallback || uiText("Request failed"),
        body.code,
    );
    const errorId =
        typeof body.details?.errorId === "string"
            ? body.details.errorId
            : undefined;

    if (errorId) {
        const url = buildReportBugUrl({
            errorId,
            errorContext: opts.errorContext,
            page:
                typeof window !== "undefined"
                    ? window.location.pathname
                    : undefined,
        });
        toast.error(message, {
            description: errorId,
            action: {
                label: uiText("Report"),
                onClick: () => {
                    window.open(url, "_blank", "noopener,noreferrer");
                },
            },
        });
    } else {
        toast.error(message);
    }

    return body;
}
