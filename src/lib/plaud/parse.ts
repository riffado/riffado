import { AppError, ErrorCode } from "@/lib/errors";

const BODY_SNIPPET_MAX = 200;

/**
 * Parse `res` as JSON or throw a typed `AppError` keyed off `res.status`.
 * Does not check `res.ok` — callers may consume 2xx bodies carrying
 * business-level status fields (e.g. Plaud's `-302` regional redirect).
 */
export async function safeParseJson<T = unknown>(res: Response): Promise<T> {
    let text = "";
    let parsed: unknown;
    let didParse = false;
    let bodyReadFailed = false;
    if (typeof res.text === "function") {
        try {
            text = await res.text();
        } catch {
            bodyReadFailed = true;
        }
        if (!bodyReadFailed && text.length > 0) {
            try {
                parsed = JSON.parse(text) as T;
                didParse = true;
            } catch {}
        }
    } else {
        try {
            parsed = await (res.json() as Promise<T>);
            didParse = true;
        } catch {}
    }
    if (didParse) return parsed as T;

    if (bodyReadFailed) {
        throw new AppError(
            ErrorCode.PLAUD_UPSTREAM_ERROR,
            "Plaud closed the connection before sending a response. Please try again later.",
            502,
            { plaudStatus: res.status },
        );
    }

    const status = res.status;
    let code: ErrorCode;
    let message: string;
    let statusCode: number;
    if (status === 401) {
        code = ErrorCode.PLAUD_INVALID_TOKEN;
        message =
            "Plaud rejected the access token. Reconnect your Plaud account.";
        statusCode = 401;
    } else if (status === 429) {
        code = ErrorCode.PLAUD_RATE_LIMITED;
        message = "Too many requests to Plaud. Please try again later.";
        statusCode = 429;
    } else if (status >= 500) {
        code = ErrorCode.PLAUD_UPSTREAM_ERROR;
        message = "Plaud is temporarily unavailable. Please try again later.";
        statusCode = 502;
    } else if (status >= 400) {
        code = ErrorCode.PLAUD_API_ERROR;
        message = `Plaud returned an unreadable response (HTTP ${status}).`;
        statusCode = 400;
    } else {
        code = ErrorCode.PLAUD_UPSTREAM_ERROR;
        message = `Plaud returned an unreadable response (HTTP ${status}).`;
        statusCode = 502;
    }

    throw new AppError(code, message, statusCode, {
        plaudStatus: status,
        bodySnippet: text.slice(0, BODY_SNIPPET_MAX),
    });
}
