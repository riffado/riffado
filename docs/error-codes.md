# Error codes

OpenPlaud's API returns a single error envelope on every failure, with one
documented exception (HTTP `416` audio range responses, see below):

```json
{
  "error": "Human-readable message, safe to display",
  "code": "MACHINE_READABLE_CODE",
  "details": { "optional": "structured context" }
}
```

### Exception: HTTP 416 on audio streaming

`GET /api/recordings/[id]/audio` returns a raw `416 Range Not Satisfiable`
response with a `Content-Range: bytes */<size>` header and **no JSON body**
when the client sends an out-of-bounds `Range` header. Browsers (and HLS /
MSE players) parse the `Content-Range` header to recover, not JSON. This
is the only route that bypasses the envelope, and only for that specific
status code; all other failures from this route still return the envelope.

- **`error`** — never contains stack traces, secrets, DB internals, or
  upstream payloads. Safe to render to end users.
- **`code`** — stable, `SCREAMING_SNAKE_CASE`, grouped by domain prefix.
  Treat the enum as a public API contract: never repurpose a shipped
  value, only add new ones (and deprecate old).
- **`details`** — optional. Whitelisted, named fields only — never splat
  in upstream objects (they may carry secrets). Examples:
  `{ field: "email" }`, `{ retryAfter: 30 }`, `{ plaudStatus: 422 }`.

The HTTP status code mirrors the class of failure:

| Status | Meaning                                                                |
| -----: | ---------------------------------------------------------------------- |
|  `400` | Invalid input / missing field / business-level Plaud rejection         |
|  `401` | Unauthenticated, or upstream credentials no longer accepted            |
|  `403` | Authenticated but not allowed                                          |
|  `404` | Resource not found                                                     |
|  `409` | Conflict / already exists                                              |
|  `413` | Payload too large                                                      |
|  `416` | Range not satisfiable (audio streaming)                                |
|  `429` | Rate limited (self or upstream)                                        |
|  `500` | Our bug                                                                |
|  `502` | Upstream (Plaud, AI provider) returned a 5xx after our retry budget    |
|  `503` | Service unavailable (e.g. background job queue down)                   |

Clients should switch on `code`, not `error`. The text of `error` may be
rephrased between releases without notice; `code` will not.

---

## Auth

| Code                    | Status | When                                                           |
| ----------------------- | -----: | -------------------------------------------------------------- |
| `AUTH_SESSION_MISSING`  |   401  | No session cookie present.                                     |
| `AUTH_SESSION_EXPIRED`  |   401  | Session cookie present but rejected as expired.                |
| `UNAUTHORIZED`          |   401  | Legacy alias for `AUTH_SESSION_MISSING`. Kept for compat.      |
| `SESSION_EXPIRED`       |   401  | Legacy alias for `AUTH_SESSION_EXPIRED`. Kept for compat.      |
| `FORBIDDEN`             |   403  | Authenticated but the resource is not yours / not allowed.     |

## Input

| Code                       | Status | `details` example      | When                                                          |
| -------------------------- | -----: | ---------------------- | ------------------------------------------------------------- |
| `INVALID_INPUT`            |   400  | `{ field }`            | Field present but malformed (e.g. token shape check).         |
| `MISSING_REQUIRED_FIELD`   |   400  | `{ field }`            | Required field absent.                                        |
| `INVALID_FILE_FORMAT`      |   400  | `{ field, expected }`  | Upload was the wrong format.                                  |

## Resource

| Code              | Status | When                                                                  |
| ----------------- | -----: | --------------------------------------------------------------------- |
| `NOT_FOUND`       |   404  | Resource doesn't exist (or doesn't exist for this user).              |
| `ALREADY_EXISTS`  |   409  | Trying to create a resource that already exists.                      |
| `CONFLICT`        |   409  | Operation conflicts with current state (e.g. concurrent modification).|

## Plaud

| Code                          | Status | `details`                          | When                                                                                                |
| ----------------------------- | -----: | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `PLAUD_NOT_CONNECTED`         |   400  | —                                  | User has no stored Plaud connection. UI should route to the connect flow.                           |
| `PLAUD_INVALID_TOKEN`         |   401  | `{ plaudStatus, plaudMessage }`    | Plaud rejected the access token (401). User must reconnect.                                         |
| `PLAUD_INVALID_API_BASE`      |   400  | —                                  | SSRF guard: `apiBase` is not a `*.plaud.ai` HTTPS host.                                             |
| `PLAUD_REGION_REDIRECT_LOOP`  |   502  | —                                  | OTP send-code redirected through more than 3 regional servers without converging.                   |
| `PLAUD_OTP_INVALID`           |   400  | `{ plaudStatus }`                  | OTP code / token not accepted by Plaud's `/auth/otp-login`.                                         |
| `PLAUD_OTP_EXPIRED`           |   400  | —                                  | OTP code expired before submission. Reserved; emitted when Plaud surfaces an expiry-specific code.  |
| `PLAUD_API_ERROR`             |   400  | `{ plaudStatus }`                  | Plaud returned a 4xx (other than 401/429) or a 200-with-`status: -N` business-level rejection.       |
| `PLAUD_UPSTREAM_ERROR`        |   502  | `{ plaudStatus, plaudMessage? }`   | Plaud returned a 5xx after our retry budget, or our infra failed talking to Plaud.                  |
| `PLAUD_RATE_LIMITED`          |   429  | `{ retryAfter? }`                  | Plaud 429 after our retry budget. `retryAfter` is the upstream `Retry-After` header in seconds.     |
| `PLAUD_WORKSPACE_UNAVAILABLE` |   400  | `{ plaudStatus? }`                 | Workspace token mint failed in a non-transient way (workspace deleted, role revoked, no workspaces).|
| `PLAUD_CONNECTION_FAILED`     |   400  | —                                  | Generic connection-flow failure not covered by the above. Prefer a more specific code.              |

## Storage

| Code                       | Status | When                                                                           |
| -------------------------- | -----: | ------------------------------------------------------------------------------ |
| `STORAGE_ERROR`            |   500  | Storage adapter failed and we don't have a more specific code yet.             |
| `STORAGE_QUOTA_EXCEEDED`   |   413  | Quota check failed before write.                                               |
| `FILE_TOO_LARGE`           |   413  | Upload exceeds `MAX_UPLOAD_BYTES` or adapter limit.                            |
| `PATH_TRAVERSAL_DETECTED`  |   400  | Local-storage path-traversal sanity check tripped.                             |

## Transcription / AI

| Code                          | Status | When                                                            |
| ----------------------------- | -----: | --------------------------------------------------------------- |
| `TRANSCRIPTION_FAILED`        |   500  | Server-side transcription pipeline failed.                      |
| `NO_TRANSCRIPTION_PROVIDER`   |   400  | User has no provider configured and chose a server-side option. |
| `TRANSCRIPTION_API_ERROR`     |   502  | Transcription provider returned an error.                       |
| `AI_PROVIDER_NOT_CONFIGURED`  |   400  | AI feature requested but no provider configured.                |
| `AI_PROVIDER_API_ERROR`       |  4xx/502 | OpenAI-compatible provider returned an error. Routes throwing this carry the upstream's status: 4xx for client-input issues, 502 for provider 5xx after retries. |
| `AI_RATE_LIMITED`             |   429  | Provider rate-limited us.                                       |

## Recordings

| Code                              | Status | When                                                          |
| --------------------------------- | -----: | ------------------------------------------------------------- |
| `RECORDING_NOT_FOUND`             |   404  | Recording doesn't exist for this user (alias of `NOT_FOUND`). |
| `RECORDING_STREAM_INVALID_RANGE`  |   416  | Audio streaming `Range` header is malformed or out of bounds. |

## Notifications

| Code                  | Status | When                                                |
| --------------------- | -----: | --------------------------------------------------- |
| `EMAIL_SEND_FAILED`   |   500  | Email transport failed for a non-config reason.     |
| `SMTP_NOT_CONFIGURED` |   500  | Email feature invoked without SMTP env vars set.    |
| `SMTP_AUTH_FAILED`    |   500  | SMTP credentials rejected.                          |
| `NOTIFICATION_FAILED` |   500  | Generic notification-delivery failure (Bark, etc.). |

## Database

| Code                          | Status | When                                                  |
| ----------------------------- | -----: | ----------------------------------------------------- |
| `DATABASE_ERROR`              |   500  | Drizzle / pg threw; not a unique-constraint failure.  |
| `UNIQUE_CONSTRAINT_VIOLATION` |   409  | Drizzle / pg unique violation.                        |

## Generic

| Code                  | Status | When                                                                       |
| --------------------- | -----: | -------------------------------------------------------------------------- |
| `INTERNAL_ERROR`      |   500  | Unmapped server error. `error` is always `"An unexpected error occurred"`. |
| `SERVICE_UNAVAILABLE` |   503  | Background dependency down (job queue, etc.).                              |
| `RATE_LIMITED`        |   429  | Self-imposed rate limit (e.g. `/api/v1/*` per-token quota).                |

---

## Versioning

The `code` enum is additive. New codes may be introduced in any release.
Existing codes will not be removed or repurposed without a deprecation
cycle that emits both the old and new code from the relevant routes,
followed by removal in a major release.

`error` text may be rephrased at any time. Clients must not match on it.

## For mobile / external clients

Switch on `code`, render `error` as a fallback toast. For codes carrying
`details` (`MISSING_REQUIRED_FIELD`, `PLAUD_RATE_LIMITED`,
`PLAUD_API_ERROR`, ...), prefer the structured field over parsing the
message.
