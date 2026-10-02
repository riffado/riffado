/**
 * Dependency-light constants and helpers for the ChatGPT plan-usage
 * provider, safe to import from anywhere (no DB, no encryption).
 */

import { AppError, ErrorCode } from "@/lib/errors";
import { CHATGPT_PROVIDER_NAME } from "./constants";

export { CHATGPT_BASE_URL, CHATGPT_PROVIDER_NAME } from "./constants";

export function isChatGptProvider(provider: string): boolean {
    return provider === CHATGPT_PROVIDER_NAME;
}

export function reconnectError(): AppError {
    return new AppError(
        ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
        "Your ChatGPT sign-in has expired. Reconnect ChatGPT in Settings → Providers.",
        400,
        { provider: CHATGPT_PROVIDER_NAME, reconnect: true },
    );
}
