import { env } from "./lib/env";

type WebhookWorkerModule = {
    startWebhookWorker: () => void;
};

export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;

    // Per-IP auth rate limiting needs a trustworthy client IP. When proxy
    // headers aren't trusted, `getClientIp` returns "unknown" and the per-IP
    // cap on /sign-in, /sign-up and /reset-password is skipped to avoid
    // collapsing every client into one cross-user-lockout bucket. Warn loudly
    // at startup so a self-host operator knows credential-stuffing protection
    // on those routes is inactive until they front the app with a proxy that
    // sets X-Forwarded-For (or cf-connecting-ip / x-real-ip) and set
    // RATE_LIMIT_TRUST_PROXY_HEADERS=true. (/forget-password keeps its
    // IP-independent per-email cap regardless.)
    if (!env.IS_HOSTED && env.RATE_LIMIT_TRUST_PROXY_HEADERS !== true) {
        console.warn(
            "[rate-limit] RATE_LIMIT_TRUST_PROXY_HEADERS is not true: per-IP rate limiting on sign-in/sign-up/reset-password is INACTIVE. Set it to true behind a trusted reverse proxy to enable credential-stuffing protection.",
        );
    }

    const { startWebhookWorker } =
        require("./lib/webhooks/worker") as WebhookWorkerModule;
    startWebhookWorker();
}
