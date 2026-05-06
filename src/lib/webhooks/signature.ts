import { createHmac, timingSafeEqual } from "node:crypto";

export function createWebhookSignature(
    secret: string,
    timestamp: number,
    body: string,
): string {
    const payload = `${timestamp}.${body}`;
    return createHmac("sha256", secret).update(payload).digest("hex");
}

export function formatWebhookSignatureHeader(
    secret: string,
    timestamp: number,
    body: string,
): string {
    return `t=${timestamp},v1=${createWebhookSignature(secret, timestamp, body)}`;
}

export function verifyWebhookSignature(
    secret: string,
    header: string,
    body: string,
    toleranceSeconds = 300,
    nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
    const parts = new Map(
        header.split(",").map((part) => {
            const [key, value] = part.split("=");
            return [key, value] as const;
        }),
    );

    const timestampRaw = parts.get("t");
    const signature = parts.get("v1");
    if (!timestampRaw || !signature) return false;

    const timestamp = Number(timestampRaw);
    if (!Number.isFinite(timestamp)) return false;
    if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

    const expected = createWebhookSignature(secret, timestamp, body);
    const expectedBuffer = Buffer.from(expected, "hex");
    const actualBuffer = Buffer.from(signature, "hex");
    if (expectedBuffer.length !== actualBuffer.length) return false;

    return timingSafeEqual(expectedBuffer, actualBuffer);
}
