/**
 * Availability of the ChatGPT plan-usage provider.
 *
 * Two independent gates:
 * - Self-host only: OpenAI requires approval for remotely hosted apps,
 *   so it never runs when `IS_HOSTED` is set.
 * - Opt-in: off unless the operator sets `ENABLE_CHATGPT_PLAN_USAGE=true`,
 *   because connecting it sends transcript text for summaries and titles
 *   to OpenAI. Operators decide that, not individual users by default.
 */

import { env } from "@/lib/env";
import { AppError, ErrorCode } from "@/lib/errors";
import { CHATGPT_PROVIDER_NAME } from "./constants";

export function isChatGptPlanUsageEnabled(): boolean {
    return !env.IS_HOSTED && env.ENABLE_CHATGPT_PLAN_USAGE === true;
}

export const CHATGPT_DISABLED_MESSAGE =
    "ChatGPT plan usage is turned off on this server. An admin can enable it by setting ENABLE_CHATGPT_PLAN_USAGE=true.";

/**
 * Guard for the ChatGPT routes and inference. Hosted: a plain 404 (the
 * feature doesn't exist there). Self-host with the flag off: a 404 that
 * says how to turn it on.
 */
export function assertChatGptPlanUsageEnabled(): void {
    if (env.IS_HOSTED) {
        throw new AppError(ErrorCode.NOT_FOUND, "Not found", 404);
    }
    if (env.ENABLE_CHATGPT_PLAN_USAGE !== true) {
        throw new AppError(
            ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
            CHATGPT_DISABLED_MESSAGE,
            404,
            { provider: CHATGPT_PROVIDER_NAME, disabled: true },
        );
    }
}
