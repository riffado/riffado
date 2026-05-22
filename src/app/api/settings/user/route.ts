import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { normalizeAiOutputLanguage } from "@/lib/ai/summary-presets";
import { requireApiSession } from "@/lib/auth-server";
import { decryptJsonField, encryptJsonField } from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

// Allowlists for enum-valued settings that the API persists as raw
// strings. The DB columns are typed `varchar` (not pg enums), so any
// validation must happen here — otherwise a misbehaving / malicious
// client could write an arbitrary value that breaks every reader
// downstream (the UI assumes a closed set of literals).
const ENUM_FIELDS = {
    playerScrubber: ["waveform", "slider"],
    listDensity: ["comfortable", "compact"],
    theme: ["light", "dark", "system"],
    dateTimeFormat: ["relative", "absolute", "iso"],
    recordingListSortOrder: ["newest", "oldest", "name"],
    transcriptionQuality: ["fast", "balanced", "accurate"],
    defaultExportFormat: ["json", "csv", "zip"],
} as const satisfies Record<string, readonly string[]>;

// O(1) membership lookup tables built once at module load. The per-request
// validator iterates many fields; .includes() over short tuples is fine but
// converting to Sets makes intent explicit and removes the lint nag.
const ENUM_FIELD_SETS: Record<string, ReadonlySet<string>> = Object.fromEntries(
    Object.entries(ENUM_FIELDS).map(([k, v]) => [k, new Set(v)]),
);

// Default settings values
const DEFAULT_SETTINGS = {
    autoTranscribe: false,
    autoSummarize: false,
    autoSummarizePreset: null,
    syncInterval: 300000, // 5 minutes in milliseconds
    autoSyncEnabled: true,
    syncOnMount: true,
    syncOnVisibilityChange: true,
    syncNotifications: true,
    defaultPlaybackSpeed: 1.0,
    defaultVolume: 75,
    autoPlayNext: false,
    playerScrubber: "waveform" as const,
    defaultTranscriptionLanguage: null,
    transcriptionQuality: "balanced" as const,
    dateTimeFormat: "relative" as const,
    recordingListSortOrder: "newest" as const,
    itemsPerPage: 50,
    listDensity: "comfortable" as const,
    theme: "system" as const,
    autoDeleteRecordings: false,
    retentionDays: null,
    browserNotifications: true,
    emailNotifications: false,
    barkNotifications: false,
    notificationSound: true,
    notificationEmail: null,
    defaultExportFormat: "json" as const,
    autoExport: false,
    backupFrequency: null,
    defaultProviders: null,
    onboardingCompleted: false,
    autoGenerateTitle: true,
    syncTitleToPlaud: false,
    aiOutputLanguage: null,
} as const;

// Settings field names (excluding userId, id, createdAt, updatedAt)
const SETTINGS_FIELDS = [
    "autoTranscribe",
    "autoSummarize",
    "autoSummarizePreset",
    "syncInterval",
    "autoSyncEnabled",
    "syncOnMount",
    "syncOnVisibilityChange",
    "syncNotifications",
    "defaultPlaybackSpeed",
    "defaultVolume",
    "autoPlayNext",
    "playerScrubber",
    "defaultTranscriptionLanguage",
    "transcriptionQuality",
    "dateTimeFormat",
    "recordingListSortOrder",
    "itemsPerPage",
    "listDensity",
    "theme",
    "autoDeleteRecordings",
    "retentionDays",
    "browserNotifications",
    "emailNotifications",
    "barkNotifications",
    "notificationSound",
    "notificationEmail",
    "defaultExportFormat",
    "autoExport",
    "backupFrequency",
    "defaultProviders",
    "onboardingCompleted",
    "autoGenerateTitle",
    "syncTitleToPlaud",
    "aiOutputLanguage",
] as const;

// Extract settings from database row to response format
function extractSettings(settings: typeof userSettings.$inferSelect) {
    const result: Record<string, unknown> = {};
    for (const field of SETTINGS_FIELDS) {
        result[field] = settings[field];
    }
    // Include barkPushUrl in response
    result.barkPushUrl = settings.barkPushUrl || null;
    result.barkPushUrlSet = !!settings.barkPushUrl;
    return result;
}

// GET - Fetch user settings
export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const [settings] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);

    // Get user email for default notification email
    const userEmail = session.user.email || "";

    // Return default settings if none exist
    if (!settings) {
        return NextResponse.json({
            ...DEFAULT_SETTINGS,
            titleGenerationPrompt: null,
            barkPushUrl: null,
            barkPushUrlSet: false,
            userEmail,
        });
    }

    const settingsData = extractSettings(settings);
    // jsonb-envelope encrypted at rest; legacy plaintext rows pass through.
    if (settings.titleGenerationPrompt) {
        settingsData.titleGenerationPrompt = decryptJsonField(
            settings.titleGenerationPrompt,
        );
    }
    if (settings.summaryPrompt) {
        settingsData.summaryPrompt = decryptJsonField(settings.summaryPrompt);
    }
    return NextResponse.json({
        ...settingsData,
        userEmail,
    });
});

// PUT - Update user settings
export const PUT = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const body = await request.json();

    // Check if settings exist
    const [existing] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);

    // Build update/insert data from body, only including defined fields
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    const insertData: Record<string, unknown> = {
        userId: session.user.id,
    };

    for (const field of SETTINGS_FIELDS) {
        let value = body[field];
        // Enum-field validation: reject unknown literals up front so a
        // bad value never reaches the DB. `undefined` (field omitted)
        // and `null` (clear) fall through; only present non-null
        // values are checked.
        if (
            field in ENUM_FIELDS &&
            value !== undefined &&
            value !== null &&
            !ENUM_FIELD_SETS[field].has(value as string)
        ) {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                `Invalid ${field} value`,
                400,
                { field },
            );
        }
        // Validate aiOutputLanguage against the allowed set. Explicit
        // `null` is allowed (clears the preference → "auto"); any other
        // non-allowlisted value is a client bug and should fail loudly
        // rather than be silently coerced.
        if (
            field === "aiOutputLanguage" &&
            value !== undefined &&
            value !== null
        ) {
            const normalized = normalizeAiOutputLanguage(value);
            if (normalized === null) {
                throw new AppError(
                    ErrorCode.INVALID_INPUT,
                    "Invalid aiOutputLanguage value",
                    400,
                    { field: "aiOutputLanguage" },
                );
            }
            value = normalized;
        }
        if (value !== undefined) {
            updateData[field] = value;
            insertData[field] = value;
        } else if (!existing) {
            // Use default value for new settings
            insertData[field] = DEFAULT_SETTINGS[field];
        }
    }

    // Handle titleGenerationPrompt separately (jsonb field). Custom
    // prompts can carry user-specific context; encrypt at rest.
    if (body.titleGenerationPrompt !== undefined) {
        const encrypted =
            body.titleGenerationPrompt === null
                ? null
                : encryptJsonField(body.titleGenerationPrompt);
        updateData.titleGenerationPrompt = encrypted;
        insertData.titleGenerationPrompt = encrypted;
    } else if (!existing) {
        insertData.titleGenerationPrompt = null;
    }

    // Handle summaryPrompt separately (jsonb field) — same envelope.
    if (body.summaryPrompt !== undefined) {
        const encrypted =
            body.summaryPrompt === null
                ? null
                : encryptJsonField(body.summaryPrompt);
        updateData.summaryPrompt = encrypted;
        insertData.summaryPrompt = encrypted;
    } else if (!existing) {
        insertData.summaryPrompt = null;
    }

    // Handle barkPushUrl separately
    if (body.barkPushUrl !== undefined) {
        if (body.barkPushUrl === null || body.barkPushUrl === "") {
            updateData.barkPushUrl = null;
            insertData.barkPushUrl = null;
        } else {
            updateData.barkPushUrl = body.barkPushUrl;
            insertData.barkPushUrl = body.barkPushUrl;
        }
    } else if (!existing) {
        insertData.barkPushUrl = null;
    }

    if (existing) {
        await db
            .update(userSettings)
            .set(updateData)
            .where(eq(userSettings.userId, session.user.id));
    } else {
        await db
            .insert(userSettings)
            .values(insertData as typeof userSettings.$inferInsert);
    }

    return NextResponse.json({ success: true });
});
