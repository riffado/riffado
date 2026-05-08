import { decrypt, encrypt } from "@/lib/encryption";

/**
 * Field-level envelope encryption for user content at rest.
 *
 * Wraps `src/lib/encryption.ts` (AES-256-GCM, server-held `ENCRYPTION_KEY`)
 * with two concerns this layer cares about and the base layer does not:
 *
 *   1. **Versioning.** New ciphertext is prefixed with `v1:` so a future
 *      key-rotation pass can identify ciphertext written under the current
 *      key. The `encrypt()` primitive's pre-existing format
 *      (`iv:authTag:hex`) used for Plaud bearer tokens and AI keys is left
 *      alone — versioning here is opt-in for new content fields.
 *
 *   2. **Legacy-plaintext compatibility.** Content fields (`transcriptions.text`,
 *      `recordings.filename`, `aiEnhancements.summary`, `actionItems`,
 *      `keyPoints`, `userSettings.summaryPrompt`, `titleGenerationPrompt`)
 *      were stored plaintext before this rollout. The read path tolerates
 *      both shapes during the deploy → backfill window. Any value not
 *      matching a known ciphertext shape is returned as-is.
 *
 * Threat model (full discussion in `docs/encryption-at-rest.md`):
 * defends against DB-only compromise — stolen backups, snapshot leaks,
 * read-replica access, SQL-injection that reads but does not execute app
 * code. **Does not** defend against a compromised app server, which holds
 * the key. True zero-knowledge for hosted users is not possible while
 * server-side AI features (transcription, summarization) are part of the
 * product. Self-host is the answer for users who require that.
 */

const VERSION_PREFIX = "v1:";

/**
 * Strict shape check for the base `encrypt()` output:
 * `<32 hex>:<32 hex>:<even-length hex>` (16-byte IV : 16-byte tag : ciphertext).
 * A plaintext transcript or filename has effectively zero probability of
 * matching this regex, so we use it to disambiguate legacy-plaintext rows
 * from already-encrypted rows.
 */
// Trailing ciphertext segment uses `(?:[0-9a-f]{2})*` so it always has an
// even number of hex chars (each byte is two hex chars; AES-GCM cannot
// produce an odd-length hex payload). The `*` (not `+`) admits the empty
// case, since encrypting an empty string is a valid round-trip for
// nullable text columns that hold `""`. Tightening odd-length to no-match
// strengthens plaintext-vs-ciphertext discrimination at the wrapper layer
// and avoids feeding obviously-malformed values into `decrypt()`.
const RAW_CIPHERTEXT_SHAPE = /^[0-9a-f]{32}:[0-9a-f]{32}:(?:[0-9a-f]{2})*$/i;

/**
 * Strict shape check for the v1 wrapper output: `v1:<raw ciphertext shape>`.
 *
 * We require the full shape after the prefix — not just the prefix — so a
 * legacy plaintext value that happens to begin with `v1:` (e.g. a filename
 * the user typed as `v1: rough draft`) is not misclassified as ciphertext
 * and forwarded into `decrypt()` where it would throw. This is the right
 * place for the check: silently catching a decrypt error elsewhere would
 * hide real corruption / tampering, which AES-GCM is supposed to surface.
 */
const V1_CIPHERTEXT_SHAPE = /^v1:[0-9a-f]{32}:[0-9a-f]{32}:(?:[0-9a-f]{2})*$/i;

function isCiphertext(value: string): boolean {
    if (V1_CIPHERTEXT_SHAPE.test(value)) return true;
    return RAW_CIPHERTEXT_SHAPE.test(value);
}

/**
 * Encrypt a string for storage in a `text` column. Output is prefixed with
 * `v1:` so the read path can identify which key/version produced it.
 *
 * Empty strings round-trip cleanly. `null`/`undefined` are passed through
 * to make column-level nullability transparent to callers.
 */
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

/**
 * Decrypt a value read from a `text` column.
 *
 * - `v1:` prefix → strip and decrypt under the current key.
 * - Bare `iv:tag:ct` shape (legacy unversioned ciphertext written by the
 *   base `encrypt()` for Plaud tokens / AI keys, in case any caller
 *   accidentally adopted that shape for content) → decrypt directly.
 * - Anything else → treat as legacy plaintext and return verbatim. This
 *   is the deploy-window compatibility path.
 *
 * Tampering (valid shape, invalid GCM tag) still raises — that's the
 * AES-GCM authenticator doing its job and we want it loud, not silent.
 */
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

/**
 * jsonb-envelope encryption for fields that historically stored a JSON
 * value (object or array). We keep the column type `jsonb` and store
 * `{ "c": "<v1:...>" }` so the schema does not change. This is option (a)
 * from the rollout plan; option (b) (jsonb → text migration) was rejected
 * to avoid a drizzle migration round-trip.
 */
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

// Overload order matters: TypeScript picks the first matching signature, so
// the more-specific `null` / `undefined` overloads must come before the
// generic `<T>` one (otherwise calls like `encryptJsonField(null)` resolve
// to the generic overload and lose the precise `null` return type).
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

/**
 * Decrypt a jsonb field. Accepts:
 *   - `{ c: "v1:..." }` envelope → decrypt and JSON.parse.
 *   - Any other JSON value (object, array, primitive) → legacy plaintext,
 *     return verbatim.
 *   - `null`/`undefined` → passthrough.
 *
 * Generic `T` is the *expected* shape; legacy rows are returned as-is and
 * are the caller's existing contract anyway.
 */
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

/**
 * Predicate exposed for the backfill script: skip rows already in the
 * current ciphertext format so the script is idempotent.
 */
export function isEncryptedText(value: string | null | undefined): boolean {
    if (value === null || value === undefined) return false;
    return isCiphertext(value);
}

export function isEncryptedJsonField(value: unknown): boolean {
    return isEnvelope(value);
}
