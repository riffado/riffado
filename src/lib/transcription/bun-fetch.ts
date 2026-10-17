/**
 * Bun's `fetch` applies a 300-second default timeout of its own, independent
 * of any AbortSignal or SDK-level timeout. For long transcriptions (multi-hour
 * recordings on a slow or self-hosted provider) that silently caps every
 * request at 5 minutes, so WHISPER_REQUEST_TIMEOUT_MS never takes effect.
 *
 * Spreading this into a fetch init (or passing it as the OpenAI SDK's
 * `fetchOptions`) disables Bun's default; the caller's own timeout still
 * applies. Other runtimes ignore the unknown `timeout` key.
 */
export const BUN_NO_FETCH_TIMEOUT = {
    timeout: false,
} as unknown as RequestInit;
