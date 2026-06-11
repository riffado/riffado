import { decrypt, encrypt } from "@/lib/encryption";

const VERSION_PREFIX = "v1:";
const RAW_CIPHERTEXT_SHAPE = /^[0-9a-f]{32}:[0-9a-f]{32}:(?:[0-9a-f]{2})*$/i;
const V1_CIPHERTEXT_SHAPE = /^v1:[0-9a-f]{32}:[0-9a-f]{32}:(?:[0-9a-f]{2})*$/i;

function isCiphertext(value: string): boolean {
    if (V1_CIPHERTEXT_SHAPE.test(value)) return true;
    return RAW_CIPHERTEXT_SHAPE.test(value);
}

/** Encrypt a `text` column value. `null`/`undefined` pass through. */
export function encryptText(plaintext: string): string;
export function encryptText(plaintext: null): null;
export function encryptText(plaintext: undefined): undefined;
export function encryptText(
    plaintext: string | null | undefined,
): string | null | undefined;
export function encryptText(
    plaintext: string | null | undefined,
): string | null | undefined {
    if (plaintext === null) return null;
    if (plaintext === undefined) return undefined;
    return `${VERSION_PREFIX}${encrypt(plaintext)}`;
}

/** Decrypt a `text` column value; legacy plaintext passes through. */
export function decryptText(value: string): string;
export function decryptText(value: null): null;
export function decryptText(value: undefined): undefined;
export function decryptText(
    value: string | null | undefined,
): string | null | undefined;
export function decryptText(
    value: string | null | undefined,
): string | null | undefined {
    if (value === null) return null;
    if (value === undefined) return undefined;
    if (V1_CIPHERTEXT_SHAPE.test(value)) {
        return decrypt(value.slice(VERSION_PREFIX.length));
    }
    if (RAW_CIPHERTEXT_SHAPE.test(value)) {
        return decrypt(value);
    }
    return value;
}

export interface EncryptedJsonEnvelope {
    c: string;
}

function isEnvelope(value: unknown): value is EncryptedJsonEnvelope {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        "c" in value &&
        typeof (value as { c: unknown }).c === "string"
    );
}

export function encryptJsonField(value: null): null;
export function encryptJsonField(value: undefined): undefined;
export function encryptJsonField<T>(value: T): EncryptedJsonEnvelope;
export function encryptJsonField<T>(
    value: T | null | undefined,
): EncryptedJsonEnvelope | null | undefined;
export function encryptJsonField<T>(
    value: T | null | undefined,
): EncryptedJsonEnvelope | null | undefined {
    if (value === null) return null;
    if (value === undefined) return undefined;
    return { c: `${VERSION_PREFIX}${encrypt(JSON.stringify(value))}` };
}

/** Decrypt a jsonb field; legacy plaintext JSON shapes pass through. */
export function decryptJsonField<T>(value: unknown): T | null {
    if (value === null || value === undefined) return null;
    if (isEnvelope(value)) {
        const inner = V1_CIPHERTEXT_SHAPE.test(value.c)
            ? value.c.slice(VERSION_PREFIX.length)
            : value.c;
        return JSON.parse(decrypt(inner)) as T;
    }
    return value as T;
}

export function isEncryptedText(value: string | null | undefined): boolean {
    if (value === null || value === undefined) return false;
    return isCiphertext(value);
}

export function isEncryptedJsonField(value: unknown): boolean {
    return isEnvelope(value);
}
