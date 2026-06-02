type WebhookWorkerModule = {
    startWebhookWorker: () => void;
};

export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;

    const { startWebhookWorker } =
        require("./lib/webhooks/worker") as WebhookWorkerModule;
    startWebhookWorker();
}
