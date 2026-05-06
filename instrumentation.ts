import { startWebhookWorker } from "./src/lib/webhooks/worker";

export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        startWebhookWorker();
    }
}
