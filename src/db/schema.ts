import {
    boolean,
    index,
    integer,
    jsonb,
    pgTable,
    real,
    text,
    timestamp,
    unique,
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
        // Unique ID from Plaud API
        plaudFileId: varchar("plaud_file_id", { length: 255 })
            .notNull()
            .unique(),
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
        presetId: varchar("preset_id", { length: 100 })
            .notNull()
            .default("general"), // Which prompt preset was used
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (table) => ({
        // Index for looking up all summaries for a recording
        recordingIdIdx: index("ai_enhancements_recording_id_idx").on(
            table.recordingId,
        ),
        // Index for user-scoped queries
        userIdIdx: index("ai_enhancements_user_id_idx").on(table.userId),
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
