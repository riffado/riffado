import { sql } from "drizzle-orm";
import {
    boolean,
    index,
    integer,
    jsonb,
    pgEnum,
    pgTable,
    real,
    text,
    timestamp,
    unique,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

// Better Auth tables (handled by Better Auth)
export const users = pgTable("users", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => nanoid()),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name"),
    // Hosted-mode operator action: when set, the user is suspended.
    // - `/api/v1/*` and the web app return a suspension state on next request
    //   (cooperative; existing in-flight requests are not interrupted).
    // - The sync worker skips suspended users on its next claim.
    // Set/cleared exclusively via the admin dashboard suspend action; the
    // self-host code path never writes this column because the admin gate
    // is locked behind IS_HOSTED.
    suspendedAt: timestamp("suspended_at"),
    suspendedReason: text("suspended_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Admin read-access audit log (hosted-only).
// Append-only. One row per admin page view or admin API hit. Self-host never
// writes here because the admin gate trips at IS_HOSTED.
export const adminAuditLog = pgTable(
    "admin_audit_log",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => nanoid()),
        // Audit retention: keep the row even if the admin's user record is
        // later deleted. `adminUserEmail` snapshots the email at log time so
        // the trail remains attributable post-deletion. `adminUserId` becomes
        // null on user delete (set null), so the FK relationship survives a
        // user purge without erasing history.
        adminUserId: text("admin_user_id").references(() => users.id, {
            onDelete: "set null",
        }),
        adminUserEmail: text("admin_user_email").notNull(),
        route: text("route").notNull(),
        method: varchar("method", { length: 10 }).notNull(),
        ip: text("ip"),
        userAgent: text("user_agent"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (table) => ({
        adminCreatedIdx: index("admin_audit_log_admin_created_idx").on(
            table.adminUserId,
            table.createdAt,
        ),
        createdIdx: index("admin_audit_log_created_idx").on(table.createdAt),
    }),
);

// Admin mutation log (hosted-only). Separate from read audit so mutations
// are easy to query/review in isolation. before/after JSON captures the
// minimum diff needed to understand the change without storing PII
// content (e.g., for softDeleteRecording we store filename hashes/sizes,
// not transcripts).
export const adminActionLog = pgTable(
    "admin_action_log",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => nanoid()),
        // Same retention model as admin_audit_log: actor user-id becomes
        // null on delete; email snapshot keeps the row attributable.
        // targetUserId already has no FK to allow logging actions on
        // already-deleted target users.
        adminUserId: text("admin_user_id").references(() => users.id, {
            onDelete: "set null",
        }),
        adminUserEmail: text("admin_user_email").notNull(),
        action: varchar("action", { length: 64 }).notNull(),
        targetUserId: text("target_user_id"),
        targetResourceId: text("target_resource_id"),
        reason: text("reason").notNull(),
        before: jsonb("before"),
        after: jsonb("after"),
        ip: text("ip"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (table) => ({
        createdIdx: index("admin_action_log_created_idx").on(table.createdAt),
        targetUserIdx: index("admin_action_log_target_user_idx").on(
            table.targetUserId,
            table.createdAt,
        ),
    }),
);

export const sessions = pgTable("sessions", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => nanoid()),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => nanoid()),
    userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => nanoid()),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Plaud connection
export const plaudConnections = pgTable("plaud_connections", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => nanoid()),
    userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    // Encrypted bearer token (long-lived ≈300 days per Plaud's JWT claims)
    bearerToken: text("bearer_token").notNull(),
    // Regional API server base URL (e.g. https://api-euc1.plaud.ai for EU users)
    apiBase: text("api_base").notNull().default("https://api.plaud.ai"),
    // Email of the linked Plaud account (captured during OTP flow). Null for
    // legacy connections created via the bearer-token paste flow.
    plaudEmail: text("plaud_email"),
    // Plaud workspace ID (e.g. ws_xxxxxxxxxxxx) used to mint short-lived
    // workspace tokens (WT) from the long-lived user token (UT). The WT is
    // required by recording endpoints (/file/simple/web, /device/list, ...)
    // on regional servers; without it those endpoints return empty lists.
    // Null for connections created before this column existed; resolved and
    // persisted lazily on next sync.
    workspaceId: text("workspace_id"),
    lastSync: timestamp("last_sync"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Plaud devices
export const plaudDevices = pgTable(
    "plaud_devices",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => nanoid()),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        serialNumber: varchar("serial_number", { length: 255 }).notNull(),
        name: text("name").notNull(),
        model: varchar("model", { length: 50 }).notNull(),
        versionNumber: integer("version_number"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => ({
        // Ensure each user can only have one entry per device serial number
        userDeviceUnique: unique().on(table.userId, table.serialNumber),
        // Index for querying devices by user
        userIdIdx: index("plaud_devices_user_id_idx").on(table.userId),
    }),
);

// Recordings
export const recordings = pgTable(
    "recordings",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => nanoid()),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        deviceSn: varchar("device_sn", { length: 255 }).notNull(),
        // Unique ID from Plaud API, scoped per OpenPlaud user.
        plaudFileId: varchar("plaud_file_id", { length: 255 }).notNull(),
        filename: text("filename").notNull(),
        duration: integer("duration").notNull(), // milliseconds
        startTime: timestamp("start_time").notNull(),
        endTime: timestamp("end_time").notNull(),
        filesize: integer("filesize").notNull(), // bytes
        fileMd5: varchar("file_md5", { length: 32 }).notNull(),
        // Storage info
        storageType: varchar("storage_type", { length: 10 }).notNull(), // 'local' or 's3'
        storagePath: text("storage_path").notNull(), // Local path or S3 key
        downloadedAt: timestamp("downloaded_at"),
        // Version from Plaud API (for detecting updates)
        plaudVersion: varchar("plaud_version", { length: 50 }).notNull(),
        // Metadata
        timezone: integer("timezone"),
        zonemins: integer("zonemins"),
        scene: integer("scene"),
        isTrash: boolean("is_trash").notNull().default(false),
        // Coarse amplitude peaks for the audio waveform, generated
        // client-side on first listen and POSTed back via
        // /api/recordings/[id]/peaks. Null until the first successful
        // decode; idempotent thereafter (write-once). Stored as a JSON
        // array of N normalized floats in [0, 1] (typically N=500),
        // so payload is ~3–6 KB. Used purely for visualization — no
        // audio reconstruction is possible from these values.
        waveformPeaks: jsonb("waveform_peaks"),
        // Caller-supplied correlation handle for server-to-server uploads
        // (`POST /api/v1/recordings`). Used by integrating systems (e.g. a
        // meeting platform that posts the recording, then receives the
        // transcription.completed webhook and needs to find its own row
        // for the result) — every webhook payload round-trips this value
        // in `external_id`. Nullable so the field is invisible to UI-only
        // users. Unique per (user_id, external_id) when set, so a retry
        // with the same external_id is idempotent.
        externalId: text("external_id"),
        // Caller-supplied context for AI tasks (transcription + summary):
        // participant names, customer / project, meeting type, vocabulary
        // the model would otherwise mis-hear ("Eibach" vs "Eich-Bach",
        // proper nouns, internal jargon). Free-text on purpose — the
        // shape varies by caller and the LLM handles arbitrary prose
        // better than rigid JSON. Encrypted at rest because it can carry
        // PII (participant names). Surfaced to:
        //   - faster-whisper's `prompt` field (priming text, ~244 token
        //     budget — we truncate) for better acoustic recognition of
        //     names and jargon
        //   - the summary system message, so attribution doesn't have
        //     to be inferred from dialogue cues alone
        // Nullable; absence means the LLM falls back to context-only
        // inference as before.
        context: text("context"),
        // Progress marker for the in-flight transcription, in seconds of
        // audio. Updated by the worker as Speaches/Whisper streams back
        // per-segment events (`stream=true`). Nullable; reset to null
        // when the worker releases the claim. The dashboard divides this
        // by `duration` (ms / 1000) to show a real progress bar instead
        // of the previous "spinner only" UX. Cleared on each new claim.
        transcriptionProgressSeconds: integer("transcription_progress_seconds"),
        // In-flight transcription claim. Set by the worker right before it
        // dispatches the provider call, cleared after success or failure
        // (whichever happens first). Used to give the manual transcribe
        // route an idempotency boundary: a second click while a previous
        // run is still in progress returns HTTP 409 instead of spawning
        // a parallel worker. The dashboard reads this through v1's
        // `transcription_in_progress` flag to keep the "Transcribing..."
        // chip visible across browser reloads, which is exactly the gap
        // that let users trigger 3+ runs by re-clicking.
        //
        // Stale-claim safety: a crashed worker would leave this set
        // forever, blocking re-transcription. The worker treats a claim
        // older than `TRANSCRIPTION_STALE_TIMEOUT_MS` as abandoned and
        // overwrites it. Long meeting audio on slow CPU-only Whisper
        // boxes is the realistic upper bound for picking that timeout.
        transcribingStartedAt: timestamp("transcribing_started_at"),
        // Soft-delete tombstone. Set when the user deletes a recording from
        // OpenPlaud's UI. Sync skips tombstoned rows so re-syncing from Plaud
        // does not resurrect deleted recordings. The audio file is hard-deleted
        // from storage at delete time; this row is retained only as a marker
        // keyed by plaudFileId. See issue #56.
        deletedAt: timestamp("deleted_at"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => ({
        // Index for querying recordings by user (most common query)
        userIdIdx: index("recordings_user_id_idx").on(table.userId),
        // Index for sync operations - looking up by plaudFileId
        plaudFileIdIdx: index("recordings_plaud_file_id_idx").on(
            table.plaudFileId,
        ),
        // Composite index for user recordings sorted by start time (dashboard query)
        userStartTimeIdx: index("recordings_user_id_start_time_idx").on(
            table.userId,
            table.startTime,
        ),
        userPlaudFileUnique: unique(
            "recordings_user_id_plaud_file_id_unique",
        ).on(table.userId, table.plaudFileId),
        // Partial unique index — only enforces uniqueness when external_id
        // is set, so the bulk of recordings (no external_id) are not
        // affected. Lets `POST /api/v1/recordings` short-circuit a retry
        // with the same external_id back to the existing row.
        userExternalIdUnique: uniqueIndex(
            "recordings_user_id_external_id_unique",
        )
            .on(table.userId, table.externalId)
            .where(sql`${table.externalId} IS NOT NULL`),
    }),
);

// Transcriptions
export const transcriptions = pgTable(
    "transcriptions",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => nanoid()),
        recordingId: text("recording_id")
            .notNull()
            .references(() => recordings.id, { onDelete: "cascade" }),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        text: text("text").notNull(),
        detectedLanguage: varchar("detected_language", { length: 10 }), // ISO 639-1 language code detected by Whisper
        transcriptionType: varchar("transcription_type", { length: 10 })
            .notNull()
            .default("server"), // 'server' or 'browser'
        provider: varchar("provider", { length: 100 }).notNull(), // e.g., 'openai', 'groq', 'browser'
        model: varchar("model", { length: 100 }).notNull(), // e.g., 'whisper-1', 'whisper-large-v3-turbo', 'whisper-base'
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (table) => ({
        // Index for looking up transcription by recording (most common query)
        recordingIdIdx: index("transcriptions_recording_id_idx").on(
            table.recordingId,
        ),
        // Index for querying user's transcriptions
        userIdIdx: index("transcriptions_user_id_idx").on(table.userId),
    }),
);

// AI Enhancements
export const aiEnhancements = pgTable(
    "ai_enhancements",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => nanoid()),
        recordingId: text("recording_id")
            .notNull()
            .references(() => recordings.id, { onDelete: "cascade" }),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        summary: text("summary"),
        actionItems: jsonb("action_items"), // Array of action items
        keyPoints: jsonb("key_points"), // Array of key points
        provider: varchar("provider", { length: 100 }).notNull(), // e.g., 'openai', 'anthropic-via-openrouter'
        model: varchar("model", { length: 100 }).notNull(), // e.g., 'gpt-4o', 'claude-3.5-sonnet'
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (table) => ({
        // Each user can have at most one enhancement per recording
        userRecordingUnique: unique().on(table.recordingId, table.userId),
    }),
);

// API Credentials (encrypted)
export const apiCredentials = pgTable("api_credentials", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => nanoid()),
    userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 100 }).notNull(), // e.g., 'openai', 'groq', 'together-ai'
    // Encrypted API key
    apiKey: text("api_key").notNull(),
    // Optional custom base URL (for OpenAI-compatible APIs)
    baseUrl: text("base_url"), // e.g., 'https://api.groq.com/openai/v1'
    // Default model for this provider
    defaultModel: varchar("default_model", { length: 100 }),
    // Whether this is the default provider for transcription/enhancement
    isDefaultTranscription: boolean("is_default_transcription")
        .notNull()
        .default(false),
    isDefaultEnhancement: boolean("is_default_enhancement")
        .notNull()
        .default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Storage Configuration
export const storageConfig = pgTable("storage_config", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => nanoid()),
    userId: text("user_id")
        .notNull()
        .unique()
        .references(() => users.id, { onDelete: "cascade" }),
    storageType: varchar("storage_type", { length: 10 }).notNull(), // 'local' or 's3'
    // Encrypted S3 config (if s3): { endpoint, bucket, region, accessKeyId, secretAccessKey }
    s3Config: jsonb("s3_config"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// User Settings
export const userSettings = pgTable("user_settings", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => nanoid()),
    userId: text("user_id")
        .notNull()
        .unique()
        .references(() => users.id, { onDelete: "cascade" }),
    // Sync interval in milliseconds (default: 300000 = 5 minutes)
    syncInterval: integer("sync_interval").notNull().default(300000),
    // Auto-transcribe new recordings
    autoTranscribe: boolean("auto_transcribe").notNull().default(false),
    // Sync settings
    autoSyncEnabled: boolean("auto_sync_enabled").notNull().default(true),
    syncOnMount: boolean("sync_on_mount").notNull().default(true),
    syncOnVisibilityChange: boolean("sync_on_visibility_change")
        .notNull()
        .default(true),
    syncNotifications: boolean("sync_notifications").notNull().default(true),
    // Playback settings
    defaultPlaybackSpeed: real("default_playback_speed").notNull().default(1.0),
    defaultVolume: integer("default_volume").notNull().default(75),
    autoPlayNext: boolean("auto_play_next").notNull().default(false),
    // Player scrubber style: 'waveform' (default) shows the canvas
    // amplitude waveform when peaks are available; 'slider' forces the
    // plain progress bar regardless. Users who prefer the minimal look
    // (or whose machines struggle with the canvas) opt out here.
    playerScrubber: varchar("player_scrubber", { length: 20 })
        .notNull()
        .default("waveform"),
    // Transcription settings
    defaultTranscriptionLanguage: varchar("default_transcription_language", {
        length: 10,
    }), // ISO 639-1 code, nullable for auto-detect
    transcriptionQuality: varchar("transcription_quality", { length: 20 })
        .notNull()
        .default("balanced"), // 'fast', 'balanced', 'accurate'
    // Display/UI settings
    dateTimeFormat: varchar("date_time_format", { length: 20 })
        .notNull()
        .default("relative"), // 'relative', 'absolute', 'iso'
    recordingListSortOrder: varchar("recording_list_sort_order", { length: 20 })
        .notNull()
        .default("newest"), // 'newest', 'oldest', 'name'
    itemsPerPage: integer("items_per_page").notNull().default(50),
    // Recording list row density: 'comfortable' (2-line, current) or 'compact' (1-line)
    listDensity: varchar("list_density", { length: 20 })
        .notNull()
        .default("comfortable"),
    theme: varchar("theme", { length: 20 }).notNull().default("system"), // 'light', 'dark', 'system'
    // Storage settings
    autoDeleteRecordings: boolean("auto_delete_recordings")
        .notNull()
        .default(false),
    retentionDays: integer("retention_days"), // nullable, range: 1-365
    // Notification settings
    browserNotifications: boolean("browser_notifications")
        .notNull()
        .default(true),
    emailNotifications: boolean("email_notifications").notNull().default(false),
    barkNotifications: boolean("bark_notifications").notNull().default(false),
    notificationSound: boolean("notification_sound").notNull().default(true),
    notificationEmail: varchar("notification_email", { length: 255 }), // nullable, for email notifications
    barkPushUrl: text("bark_push_url"), // nullable, full Bark push URL (e.g., https://api.day.app/your_key)
    // Export/Backup settings
    defaultExportFormat: varchar("default_export_format", { length: 10 })
        .notNull()
        .default("json"), // 'json', 'txt', 'srt', 'vtt'
    autoExport: boolean("auto_export").notNull().default(false),
    backupFrequency: varchar("backup_frequency", { length: 20 }), // nullable, 'daily', 'weekly', 'monthly', 'never'
    // Default providers (for quick selection)
    defaultProviders: jsonb("default_providers"), // { transcription: 'openai', enhancement: 'claude' }
    // Onboarding
    onboardingCompleted: boolean("onboarding_completed")
        .notNull()
        .default(false),
    // Title generation
    autoGenerateTitle: boolean("auto_generate_title").notNull().default(true),
    syncTitleToPlaud: boolean("sync_title_to_plaud").notNull().default(false),
    // Title generation prompt configuration
    titleGenerationPrompt: jsonb("title_generation_prompt"), // { preset: string, customPrompt?: string }
    // Summary prompt configuration
    summaryPrompt: jsonb("summary_prompt"), // { selectedPrompt: string, customPrompts: CustomPrompt[] }
    // AI output language (applies to summaries and AI-generated titles).
    // null or "auto" => match transcript language (default behavior).
    aiOutputLanguage: text("ai_output_language"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const apiKeySourceEnum = pgEnum("api_key_source", [
    "manual",
    "device-flow",
]);

export const apiKeys = pgTable(
    "api_keys",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => nanoid()),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        keyHash: text("key_hash").notNull().unique(),
        keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
        source: apiKeySourceEnum("source").notNull().default("manual"),
        scopes: jsonb("scopes").$type<string[]>().notNull().default(["read"]),
        lastUsedAt: timestamp("last_used_at"),
        expiresAt: timestamp("expires_at"),
        revokedAt: timestamp("revoked_at"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => ({
        userIdIdx: index("api_keys_user_id_idx").on(table.userId),
        // No explicit index on `key_hash`: the unique constraint above
        // already creates an implicit btree index Postgres uses for the
        // `where key_hash = ?` lookup in `authenticateRequest`. A second
        // explicit index would just double the write cost on every issue
        // / revoke.
    }),
);

export const webhookEndpoints = pgTable(
    "webhook_endpoints",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => nanoid()),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        // Encrypted target URL. Receiver URLs can contain path/query secrets.
        url: text("url").notNull(),
        secret: text("secret").notNull(),
        events: jsonb("events").$type<string[]>().notNull(),
        description: text("description"),
        enabled: boolean("enabled").notNull().default(true),
        lastDeliveryAt: timestamp("last_delivery_at"),
        lastDeliveryStatus: varchar("last_delivery_status", {
            length: 16,
        }),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => ({
        userIdIdx: index("webhook_endpoints_user_id_idx").on(table.userId),
    }),
);

export const webhookDeliveries = pgTable(
    "webhook_deliveries",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => nanoid()),
        endpointId: text("endpoint_id")
            .notNull()
            .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        recordingId: text("recording_id").references(() => recordings.id, {
            onDelete: "cascade",
        }),
        event: varchar("event", { length: 64 }).notNull(),
        payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
        status: varchar("status", { length: 16 }).notNull(),
        attempts: integer("attempts").notNull().default(0),
        lastAttemptAt: timestamp("last_attempt_at"),
        nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
        lastResponseStatus: integer("last_response_status"),
        lastResponseBody: text("last_response_body"),
        lastError: text("last_error"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => ({
        pendingScanIdx: index("webhook_deliveries_pending_idx").on(
            table.status,
            table.nextAttemptAt,
        ),
        endpointIdIdx: index("webhook_deliveries_endpoint_id_idx").on(
            table.endpointId,
        ),
        recordingIdIdx: index("webhook_deliveries_recording_id_idx").on(
            table.recordingId,
        ),
    }),
);

export const apiRateLimitBuckets = pgTable(
    "api_rate_limit_buckets",
    {
        key: text("key").primaryKey(),
        count: integer("count").notNull().default(0),
        resetAt: timestamp("reset_at").notNull(),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => ({
        resetAtIdx: index("api_rate_limit_buckets_reset_at_idx").on(
            table.resetAt,
        ),
    }),
);
