# API Documentation

OpenPlaud API reference for all endpoints.

## Base URL

```
http://localhost:3000/api
```

## Authentication

Browser endpoints require a valid session cookie set by Better Auth.

Automation endpoints under `/api/v1/` also accept personal access tokens:

```http
Authorization: Bearer opp_...
```

Tokens are created from Settings -> API Tokens. The raw token is shown once,
stored as a SHA-256 hash, and can be revoked at any time.

## Endpoints

### Health

#### GET `/health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-22T12:00:00.000Z"
}
```

---

### Authentication

#### POST `/auth/sign-up`

Create a new user account.

**Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "name": "John Doe"
}
```

#### POST `/auth/sign-in`

Sign in to existing account.

**Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

#### POST `/auth/sign-out`

Sign out current user.

---

### Plaud Integration

#### POST `/plaud/auth/send-code`

Send a one-time verification code to the user's Plaud email. Handles regional redirects automatically — if the account lives on a different regional server, the correct `apiBase` is returned.

**Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "otpToken": "eyJhbGc...",
  "apiBase": "https://api-euc1.plaud.ai"
}
```

#### POST `/plaud/auth/verify`

Verify the OTP code, obtain a long-lived access token from Plaud, and store the encrypted connection.

**Body:**
```json
{
  "code": "123456",
  "otpToken": "eyJhbGc...",
  "apiBase": "https://api-euc1.plaud.ai",
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "devices": [...]
}
```

#### GET `/plaud/connection`

Get current Plaud connection status.

**Response:**
```json
{
  "connected": true,
  "server": "eu",
  "plaudEmail": "user@example.com",
  "createdAt": "2025-01-22T12:00:00.000Z",
  "updatedAt": "2025-01-22T12:00:00.000Z"
}
```

#### DELETE `/plaud/connection`

Disconnect the current Plaud account. Deletes the stored connection and device records; synced recordings are preserved in OpenPlaud storage.

**Response:**
```json
{
  "success": true
}
```

#### POST `/plaud/sync`

Manually trigger sync of recordings from Plaud device.

**Response:**
```json
{
  "success": true,
  "newRecordings": 5,
  "updatedRecordings": 2,
  "errors": []
}
```

---

### Recordings

#### GET `/recordings`

List all recordings for current user.

**Query Parameters:**
- `limit` (optional): Number of results (default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Response:**
```json
{
  "recordings": [
    {
      "id": "abc123",
      "filename": "Meeting Notes",
      "duration": 3600000,
      "startTime": "2025-01-22T10:00:00.000Z",
      "filesize": 15728640,
      "deviceSn": "888317426694681884"
    }
  ],
  "total": 100
}
```

#### GET `/recordings/[id]`

Get single recording by ID.

**Response:**
```json
{
  "id": "abc123",
  "filename": "Meeting Notes",
  "duration": 3600000,
  "startTime": "2025-01-22T10:00:00.000Z",
  "transcription": {...},
  "aiEnhancements": {...}
}
```

#### GET `/recordings/[id]/audio`

Stream audio file.

**Headers:**
- `Range`: Optional byte range (e.g., `bytes=0-1023`)

**Response:**
- Content-Type: audio/mpeg, audio/opus, etc.
- Supports HTTP range requests (206 Partial Content)

#### POST `/recordings/[id]/transcribe`

Transcribe a recording.

**Body:**
```json
{
  "provider": "openai",
  "model": "whisper-1"
}
```

**Response:**
```json
{
  "success": true,
  "transcriptionId": "xyz789",
  "text": "Transcribed text...",
  "detectedLanguage": "en"
}
```

---

### Settings

#### GET `/settings/tokens`

List personal access tokens for the signed-in user. Requires a session cookie;
tokens cannot manage tokens.

#### POST `/settings/tokens`

Create a read-only personal access token. The raw `token` field is returned
once.

**Body:**
```json
{
  "name": "Hermes Agent",
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "scopes": ["read"]
}
```

#### DELETE `/settings/tokens/[id]`

Revoke a personal access token.

#### GET `/settings/user`

Get user settings.

**Response:**
```json
{
  "autoTranscribe": false,
  "emailNotifications": true,
  "notificationEmail": "user@example.com",
  "syncInterval": 300000,
  "defaultPlaybackSpeed": 1.0
}
```

#### PUT `/settings/user`

Update user settings.

**Body:**
```json
{
  "autoTranscribe": true,
  "emailNotifications": true
}
```

#### PUT `/settings/storage`

Configure storage provider.

**Body:**
```json
{
  "storageType": "s3",
  "s3Config": {
    "endpoint": "https://...",
    "bucket": "openplaud",
    "region": "us-east-1",
    "accessKeyId": "...",
    "secretAccessKey": "..."
  }
}
```

#### GET `/settings/ai/providers`

List AI providers.

**Response:**
```json
{
  "providers": [
    {
      "id": "xyz",
      "provider": "openai",
      "baseUrl": null,
      "defaultModel": "whisper-1",
      "isDefaultTranscription": true
    }
  ]
}
```

#### POST `/settings/ai/providers`

Add new AI provider.

**Body:**
```json
{
  "provider": "groq",
  "apiKey": "gsk_...",
  "baseUrl": "https://api.groq.com/openai/v1",
  "defaultModel": "whisper-large-v3",
  "isDefaultTranscription": true
}
```

#### PUT `/settings/ai/providers/[id]`

Update AI provider.

#### DELETE `/settings/ai/providers/[id]`

Delete AI provider.

#### POST `/settings/test-email`

Send test email to verify SMTP configuration.

**Body:**
```json
{
  "email": "user@example.com"
}
```

---

### Automation API v1

All v1 endpoints accept either a browser session cookie or
`Authorization: Bearer opp_...`.

#### GET `/v1/recordings`

List recordings with cursor pagination and incremental filters.

**Query Parameters:**
- `cursor`: base64url cursor from `next_cursor`
- `limit`: 1-100, default 50
- `created_since`: ISO timestamp
- `updated_since`: ISO timestamp; includes recording metadata, transcript,
  summary, and generated-title changes
- `has_transcription`: `true` or `false`

**Response:**
```json
{
  "data": [
    {
      "id": "abc123",
      "title": "Meeting Notes",
      "created_at": "2026-05-06T12:00:00.000Z",
      "updated_at": "2026-05-06T12:05:00.000Z",
      "recorded_at": "2026-05-06T11:30:00.000Z",
      "duration_ms": 3600000,
      "filesize_bytes": 15728640,
      "device": {
        "serial_number": "888317426694681884",
        "name": "Plaud Note",
        "model": "Note"
      },
      "has_transcription": true,
      "has_summary": false,
      "links": {
        "self": "/api/v1/recordings/abc123",
        "transcript": "/api/v1/recordings/abc123/transcript",
        "audio": "/api/v1/recordings/abc123/audio"
      }
    }
  ],
  "next_cursor": null,
  "has_more": false
}
```

`updated_at` is the recording resource timestamp for v1 clients. It changes
when the recording metadata changes and when transcript, summary, or generated
title state changes.

#### GET `/v1/recordings/[id]`

Return the stable recording shape plus inline `transcript` and `summary`
objects when present.

#### GET `/v1/recordings/[id]/transcript`

Return transcript text and provider metadata, or `404` when the recording has
not been transcribed.

#### GET `/v1/recordings/[id]/audio`

Return a `302` redirect to a presigned S3 URL for S3 storage, or stream local
audio with byte-range support for local storage.

---

### Export & Backup

#### GET `/export`

Export recordings in various formats.

**Query Parameters:**
- `format`: json | txt | srt | vtt

**Response:**
- File download

#### POST `/backup`

Create backup of all user data.

**Response:**
```json
{
  "success": true,
  "backupUrl": "/backups/user_20250122_120000.zip"
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

### Error Codes

- `UNAUTHORIZED`: Not authenticated
- `FORBIDDEN`: Insufficient permissions
- `NOT_FOUND`: Resource not found
- `INVALID_INPUT`: Validation failed
- `PLAUD_API_ERROR`: Plaud API failure
- `TRANSCRIPTION_FAILED`: Transcription error
- `STORAGE_ERROR`: Storage operation failed
- `EMAIL_SEND_FAILED`: Email notification failed
- `INTERNAL_ERROR`: Server error

---

## Rate Limiting

Rate limiting is not currently enforced but may be added in future versions.

## Webhooks

Webhooks are configured from Settings -> Webhooks. Endpoint URLs must use
HTTPS.

Supported events:
- `recording.synced`
- `recording.updated`
- `transcription.completed`
- `transcription.failed`

OpenPlaud signs each request with HMAC-SHA256:

```http
X-OpenPlaud-Event: transcription.completed
X-OpenPlaud-Delivery: <delivery-id>
X-OpenPlaud-Timestamp: 1778078610
X-OpenPlaud-Signature: t=1778078610,v1=<hex hmac>
```

The signature input is:

```
<unix_timestamp>.<raw_json_body>
```

Verify with the endpoint secret returned on creation. Reject old timestamps
(five minutes is a reasonable default) and compare signatures in constant time.

Delivery uses an in-process worker started by Next.js `instrumentation.ts`.
This matches the Docker deployment model. Stateless serverless deployments need
an external process or cron to run deliveries reliably.

Delivery history stores only minimal event metadata. Recording, transcript, and
summary data are hydrated at send time and redacted from delivery history when a
recording is deleted.

Retries use exponential backoff: 30 seconds, 2 minutes, 10 minutes, 1 hour,
then 6 hours. After six failed attempts, the delivery is marked `dead`.

## SDK / Client Libraries

Currently, no official SDK is available. The API is RESTful and can be consumed by any HTTP client.

Example with JavaScript:

```javascript
// Fetch recordings
const response = await fetch('/api/recordings', {
  credentials: 'include'  // Include session cookie
});
const data = await response.json();
```

---

For more details, see the source code in `src/app/api/`.
