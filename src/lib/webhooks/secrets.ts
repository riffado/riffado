import { decrypt, encrypt } from "@/lib/encryption";

export function encryptWebhookSecret(secret: string): string {
    return encrypt(secret);
}

export function decryptWebhookSecret(storedSecret: string): string {
    if (storedSecret.startsWith("whsec_")) return storedSecret;
    return decrypt(storedSecret);
}

export function maskWebhookSecret(secret: string): string {
    return `whsec_****${secret.slice(-4)}`;
}

export function maskStoredWebhookSecret(storedSecret: string): string {
    return maskWebhookSecret(decryptWebhookSecret(storedSecret));
}
