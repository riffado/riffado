import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { enforceAuthRateLimit } from "@/lib/auth-rate-limit";
import { enforceTurnstile } from "@/lib/turnstile";

const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

export async function POST(request: Request): Promise<Response> {
    const limited = await enforceAuthRateLimit(request);
    if (limited) return limited;
    const captchaRejected = await enforceTurnstile(request);
    if (captchaRejected) return captchaRejected;
    return handlers.POST(request);
}
