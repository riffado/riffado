type WebhookWorkerModule = {
    startWebhookWorker: () => void;
};

type BillingWorkerModule = {
    startBillingWorker: () => void;
};

type BackgroundSyncWorkerModule = {
    startBackgroundSyncWorker: () => void;
};

type ExportWorkerModule = {
    startExportWorker: () => void;
};

type EnvModule = {
    env: {
        IS_HOSTED: boolean;
        RATE_LIMIT_TRUST_PROXY_HEADERS?: boolean;
    };
};

export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;

    // Deferred require (matches the worker import below): a top-level
    // `import { env }` would run full env validation at module load in every
    // runtime -- including edge, where this hook must no-op -- before the
    // guard above. Loading it here keeps validation inside the nodejs branch.
    const { env } = require("./lib/env") as EnvModule;

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

    const { startBillingWorker } =
        require("./lib/hosted/billing/worker") as BillingWorkerModule;
    startBillingWorker();

    const { startBackgroundSyncWorker } =
        require("./lib/hosted/sync/worker") as BackgroundSyncWorkerModule;
    startBackgroundSyncWorker();

    const { startExportWorker } =
        require("./lib/export/worker") as ExportWorkerModule;
    startExportWorker();
}
