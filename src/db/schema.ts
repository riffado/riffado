import { sql } from "drizzle-orm";
import {
    bigint,
    boolean,
    date,
    index,
    integer,
    jsonb,
    pgEnum,
    pgTable,
    primaryKey,
    real,
    text,
    timestamp,
    unique,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

export const userPlanEnum = pgEnum("user_plan", [
    "self_host",
    "hosted_free",
    "hosted_pro",
]);

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
    marketingEmailConsent: boolean("marketing_email_consent")
        .notNull()
        .default(false),
    // Hosted billing plan. NULL on self-host and for hosted users created
    // before the billing rollout (backfilled by scripts/billing-backfill.ts).
    plan: userPlanEnum("plan"),
    // Set by the billing rollout backfill to (launch_date + 30 days) for
    // every pre-launch hosted user. While > now(), enforcement skips caps.
    planTransitionUntil: timestamp("plan_transition_until"),
    // Per-cycle Mynah transcription budget in seconds. Reset by cycle-close.
    monthlyMynahSecondsRemaining: integer("monthly_mynah_seconds_remaining")
        .notNull()
        .default(0),
    // Next time cycle-close should refresh the Mynah counter. NULL = never.
    monthlyMynahGrantResetAt: timestamp("monthly_mynah_grant_reset_at"),
    // True iff first paid subscription was created within the founding window.
    // Locks the $5/mo price forever per the consolidated plan.
    foundingMember: boolean("founding_member").notNull().default(false),
    // First time the user was successfully charged. NULL = never paid.
    // Used to branch the grace-period policy on lapse:
    //  - NULL (trial non-convert) -> BILLING_TRIAL_GRACE_DAYS (7)
    //  - set (former paying user)  -> BILLING_PAID_GRACE_DAYS (30)
    // Grandfather: pre-launch users are treated as Path B (paid) by checking
    // `createdAt < BILLING_LAUNCH_DATE` at deletion-scheduling time, so this
    // column staying NULL for grandfathered users is intentional.
    everPaidAt: timestamp("ever_paid_at"),
    // When the user enters a lapsed state (trial ended w/o payment, sub
    // canceled/failed-out, etc.) this is set to now() + grace_days. The
    // billing worker deletes the account at that time. Cleared on reactivate.
    accountDeletionScheduledAt: timestamp("account_deletion_scheduled_at"),
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
        // Unique ID from Plaud API, scoped per Riffado user.
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
        // Soft-delete tombstone. Set when the user deletes a recording from
        // Riffado's UI. Sync skips tombstoned rows so re-syncing from Plaud
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
    // Authoritative default transcription provider: an api_credentials id,
    // the managed "riffado-included" sentinel, or null (no explicit choice
    // -> hosted managed fallback). Supersedes the per-row
    // api_credentials.is_default_transcription boolean for selection.
    defaultTranscriptionProviderId: text("default_transcription_provider_id"),
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

export const exportJobStatusEnum = pgEnum("export_job_status", [
    "pending",
    "processing",
    "completed",
    "failed",
]);

/**
 * A queued request to build a full-data archive (audio + transcript +
 * summary per recording, zipped) for one user. Built asynchronously by
 * the worker in `src/lib/export/worker.ts` -- creating this row must
 * stay cheap; all the heavy lifting (streaming audio out of storage,
 * zipping, streaming the archive back into storage) happens off the
 * request thread.
 *
 * `storageKey` + `expiresAt` are only set once `status = 'completed'`.
 * The cleanup pass in the same worker deletes the archive from storage
 * and the row once `expiresAt` has passed, so archives don't accumulate
 * storage cost indefinitely.
 */
export const exportJobs = pgTable(
    "export_jobs",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => nanoid()),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        status: exportJobStatusEnum("status").notNull().default("pending"),
        storageKey: text("storage_key"),
        // bigint, not integer: a full-library archive (audio for every
        // recording, uncompressed) can exceed 2^31-1 bytes (~2GB) well
        // within the hosted_pro 50GB storage cap.
        fileSize: bigint("file_size", { mode: "number" }),
        recordingCount: integer("recording_count"),
        errorMessage: text("error_message"),
        // Bumped on every failed build attempt. Once it reaches the
        // worker's max-attempts constant, a failure sticks as `failed`
        // instead of being requeued to `pending` -- bounds retries for a
        // job that's failing for a durable reason (not just a transient
        // blip) instead of retrying it forever.
        attempts: integer("attempts").notNull().default(0),
        // Random token stamped on every claim (`claimPendingExportJobs`).
        // A worker may only complete/fail the specific claim it holds --
        // every write is scoped `where id = ... and claim_token = ...`.
        // This is what makes the stale-processing reclaim safe even
        // though it can't distinguish "process crashed" from "still
        // running, just slow": if a reclaimed job's original (zombie)
        // worker eventually finishes and tries to write, its claim token
        // no longer matches (the reclaim cleared it), so the write
        // affects zero rows instead of corrupting whatever the new
        // claim has since done with the job.
        claimToken: text("claim_token"),
        // Storage keys from abandoned attempts (per-claim-token keys --
        // see `claimToken` above -- from claims reclaimed as stale,
        // i.e. the worker holding them almost certainly crashed
        // mid-build). Nothing else ever looks these up once the claim
        // is cleared, so without tracking them here they'd be permanent
        // storage leaks: `reclaimStaleProcessingExportJobs` appends the
        // abandoned key here before clearing `claimToken`, and the
        // worker's cleanup pass sweeps + clears entries from this list
        // once the underlying object is actually deleted.
        staleStorageKeys: jsonb("stale_storage_keys")
            .$type<string[]>()
            .notNull()
            .default(sql`'[]'::jsonb`),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        startedAt: timestamp("started_at"),
        completedAt: timestamp("completed_at"),
        expiresAt: timestamp("expires_at"),
    },
    (table) => ({
        userIdIdx: index("export_jobs_user_id_idx").on(table.userId),
        // Claim query scans pending rows oldest-first.
        statusCreatedAtIdx: index("export_jobs_status_created_at_idx").on(
            table.status,
            table.createdAt,
        ),
        // Cleanup pass scans completed rows past expiry.
        expiresAtIdx: index("export_jobs_expires_at_idx").on(table.expiresAt),
        // Enforces "one active job per user" at the database layer --
        // the application-level check-then-insert in POST /api/backup is
        // only a fast path; this index is what actually prevents two
        // concurrent requests from both slipping past that check and
        // enqueuing duplicate jobs.
        userActiveUnique: uniqueIndex("export_jobs_user_active_unique")
            .on(table.userId)
            .where(sql`${table.status} in ('pending', 'processing')`),
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

/**
 * Aggregate hit counter for the install.sh routes. Counts every fetch of
 * `/install.sh` and `/{version}/install.sh` on the hosted instance.
 *
 * Privacy: no IP, no User-Agent, no identifier of any kind. Just (day,
 * version) -> count. This is first-party traffic on our own webserver,
 * not user-device storage. Self-host instances do NOT write to this
 * table -- writes are gated on env.IS_HOSTED.
 *
 * Not an instance count. One operator re-running `install.sh` five times
 * is five hits. CI pipelines count every run. Read as a directional
 * trend, not absolute deployments.
 */
export const installScriptHits = pgTable(
    "install_script_hits",
    {
        day: date("day").notNull(),
        /** "latest" for the unversioned route, "vX.Y.Z" for versioned, "invalid" for anything that fails the version regex. */
        version: text("version").notNull(),
        count: integer("count").notNull().default(0),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.day, table.version] }),
    }),
);

export const emailSuppressions = pgTable(
    "email_suppressions",
    {
        email: text("email").primaryKey(),
        reason: varchar("reason", { length: 20 }).notNull(),
        note: text("note"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (table) => ({
        createdAtIdx: index("email_suppressions_created_at_idx").on(
            table.createdAt,
        ),
    }),
);

export const emailCampaigns = pgTable("email_campaigns", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => nanoid()),
    slug: text("slug").notNull().unique(),
    subject: text("subject").notNull(),
    kind: varchar("kind", { length: 20 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const emailDeliveries = pgTable(
    "email_deliveries",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => nanoid()),
        campaignId: text("campaign_id")
            .notNull()
            .references(() => emailCampaigns.id, { onDelete: "cascade" }),
        userId: text("user_id").references(() => users.id, {
            onDelete: "set null",
        }),
        subscriberId: text("subscriber_id").references(
            () => newsletterSubscriptions.id,
            { onDelete: "set null" },
        ),
        email: text("email").notNull(),
        status: varchar("status", { length: 30 }).notNull(),
        messageId: text("message_id"),
        error: text("error"),
        sentAt: timestamp("sent_at"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => ({
        campaignEmailUnique: unique(
            "email_deliveries_campaign_email_unique",
        ).on(table.campaignId, table.email),
        campaignStatusIdx: index("email_deliveries_campaign_status_idx").on(
            table.campaignId,
            table.status,
        ),
        userIdIdx: index("email_deliveries_user_id_idx").on(table.userId),
    }),
);

export const emailValidations = pgTable(
    "email_validations",
    {
        email: text("email").primaryKey(),
        reachable: varchar("reachable", { length: 20 }).notNull(),
        isDisposable: boolean("is_disposable").notNull().default(false),
        isRoleAccount: boolean("is_role_account").notNull().default(false),
        hasFullInbox: boolean("has_full_inbox").notNull().default(false),
        isCatchAll: boolean("is_catch_all").notNull().default(false),
        mxAccepts: boolean("mx_accepts").notNull().default(false),
        rawResponse: jsonb("raw_response"),
        provider: varchar("provider", { length: 30 })
            .notNull()
            .default("reacher-stacked"),
        checkedAt: timestamp("checked_at").notNull().defaultNow(),
    },
    (table) => ({
        checkedAtIdx: index("email_validations_checked_at_idx").on(
            table.checkedAt,
        ),
    }),
);

export const newsletterSubscriptions = pgTable(
    "newsletter_subscriptions",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => nanoid()),
        email: text("email").notNull().unique(),
        source: varchar("source", { length: 20 }).notNull(), // 'landing' | 'install' | 'admin'
        consentedAt: timestamp("consented_at").notNull().defaultNow(),
        confirmedAt: timestamp("confirmed_at"),
        unsubscribedAt: timestamp("unsubscribed_at"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => ({
        confirmedAtIdx: index("newsletter_subscriptions_confirmed_at_idx").on(
            table.confirmedAt,
        ),
    }),
);

export const billingCustomers = pgTable("billing_customers", {
    userId: text("user_id")
        .primaryKey()
        .references(() => users.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const subscriptions = pgTable(
    "subscriptions",
    {
        id: text("id").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        stripeCustomerId: text("stripe_customer_id").notNull(),
        stripePriceId: text("stripe_price_id"),
        status: varchar("status", { length: 24 }).notNull(),
        amountValue: text("amount_value").notNull(),
        amountCurrency: varchar("amount_currency", { length: 3 }).notNull(),
        interval: text("interval").notNull(),
        description: text("description"),
        /** ISO-3166-1 alpha-2 billing country, for our own VAT-OSS records. */
        billingCountry: varchar("billing_country", { length: 2 }),
        startDate: timestamp("start_date"),
        nextPaymentAt: timestamp("next_payment_at"),
        canceledAt: timestamp("canceled_at"),
        withdrawalWaiverAcceptedAt: timestamp("withdrawal_waiver_accepted_at"),
        metadata: jsonb("metadata"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => ({
        userIdActiveUnique: uniqueIndex("subscriptions_user_id_active_unique")
            .on(table.userId)
            .where(sql`${table.status} IN ('active', 'trialing', 'past_due')`),
        userStatusIdx: index("subscriptions_user_status_idx").on(
            table.userId,
            table.status,
        ),
    }),
);

export const stripeWebhookEvents = pgTable(
    "stripe_webhook_events",
    {
        eventId: text("event_id").primaryKey(),
        type: varchar("type", { length: 60 }).notNull(),
        processedAt: timestamp("processed_at").notNull().defaultNow(),
    },
    (table) => ({
        processedAtIdx: index("stripe_webhook_events_processed_at_idx").on(
            table.processedAt,
        ),
    }),
);

export const emailLog = pgTable(
    "email_log",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => nanoid()),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        // Wide enough for namespaced per-object keys such as
        // `payment_failed:<invoiceId>` (prefix + `in_...` id ~= 42 chars).
        kind: varchar("kind", { length: 120 }).notNull(),
        sentAt: timestamp("sent_at").notNull().defaultNow(),
    },
    (table) => ({
        userKindUnique: unique("email_log_user_kind_unique").on(
            table.userId,
            table.kind,
        ),
    }),
);
