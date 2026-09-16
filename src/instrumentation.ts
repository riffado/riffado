import { usesDefaultPostgresPassword } from "./lib/postgres-password";

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
        DATABASE_URL?: string;
    };
};

type PosthogServerModule = {
    captureServerException: (
        error: unknown,
        context: { source: string; [key: string]: unknown },
    ) => void;
    getPostHogClient: () => {
        captureExceptionImmediate: (
            error: unknown,
            distinctId: string,
            properties?: Record<string, unknown>,
        ) => Promise<unknown>;
    } | null;
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
    // RATE_LIMIT_TRUST_PROXY_HEADERS=true. (/request-password-reset keeps its
    // IP-independent per-email cap regardless.)
    if (!env.IS_HOSTED && env.RATE_LIMIT_TRUST_PROXY_HEADERS !== true) {
        console.warn(
            "[rate-limit] RATE_LIMIT_TRUST_PROXY_HEADERS is not true: per-IP rate limiting on sign-in/sign-up/reset-password is INACTIVE. Set it to true behind a trusted reverse proxy to enable credential-stuffing protection.",
        );
    }

    if (usesDefaultPostgresPassword(env.DATABASE_URL)) {
        console.warn(
            "[db] DATABASE_URL uses the known default password \"postgres\". Set a unique POSTGRES_PASSWORD in .env and rotate the role in place (ALTER USER postgres WITH PASSWORD '...'; then recreate the app). Recreating the db volume is not required.",
        );
    }

    const { startWebhookWorker } =
        require("./lib/webhooks/worker") as WebhookWorkerModule;
    startWebhookWorker();

    const { startBillingWorker } =
        require("./lib/hosted/billing/worker") as BillingWorkerModule;
    startBillingWorker();

    const { startBackgroundSyncWorker } =
        require("./lib/sync/worker") as BackgroundSyncWorkerModule;
    startBackgroundSyncWorker();

    const { startExportWorker } =
        require("./lib/export/worker") as ExportWorkerModule;
    startExportWorker();

    // Catch anything that escapes a background worker's own try/catch (or
    // any other unexpected process-level throw) instead of only ever
    // hitting the container log. Both no-op on self-host (no PostHog
    // client configured).
    const { captureServerException, getPostHogClient } =
        require("./lib/posthog-server") as PosthogServerModule;

    // `uncaughtException` means the process is in an unknown state --
    // Node's own guidance is log then exit, never swallow-and-continue.
    // Without an explicit exit here, adding this listener would silently
    // change today's behavior from "process crashes, orchestrator restarts
    // it" to "process keeps running corrupted", which is worse than not
    // capturing at all. Capture is awaited (bounded) so the exception has
    // a chance to actually reach PostHog before the process dies --
    // `captureServerException`'s normal fire-and-forget shape can't
    // guarantee that here.
    process.on("uncaughtException", (error) => {
        console.error("[process] uncaughtException:", error);
        const client = getPostHogClient();
        const flush = client
            ? client
                  .captureExceptionImmediate(error, "server", {
                      source: "process:uncaughtException",
                  })
                  .catch(() => undefined)
            : Promise.resolve();
        Promise.race([flush, new Promise((r) => setTimeout(r, 3000))]).finally(
            () => process.exit(1),
        );
    });
    process.on("unhandledRejection", (reason) => {
        console.error("[process] unhandledRejection:", reason);
        captureServerException(reason, {
            source: "process:unhandledRejection",
        });
    });
}

/**
 * Next.js request-error hook (App Router, Node runtime). Fires for any
 * error that escapes a Server Component, Route Handler, or Server Action
 * without being caught -- this is what closes the gap `apiHandler`-based
 * capture can't: routes that don't use `apiHandler` (better-auth, health,
 * the PostHog proxy passthroughs, etc.) and React Server Component render
 * errors. Hard-gated on IS_HOSTED inside `captureServerException` itself.
 */
export async function onRequestError(
    error: unknown,
    request: Readonly<{ path: string; method: string }>,
    context: Readonly<{ routerKind: string; routeType: string }>,
): Promise<void> {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    const { captureServerException } =
        require("./lib/posthog-server") as PosthogServerModule;
    captureServerException(error, {
        source: "onRequestError",
        route: request.path,
        method: request.method,
        routerKind: context.routerKind,
        routeType: context.routeType,
    });
}
