import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { normalizeAiOutputLanguage } from "@/lib/ai/summary-presets";
import { auth } from "@/lib/auth";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

// Default settings values
const DEFAULT_SETTINGS = {
    autoTranscribe: false,
    syncInterval: 300000, // 5 minutes in milliseconds
    autoSyncEnabled: true,
    syncOnMount: true,
    syncOnVisibilityChange: true,
    syncNotifications: true,
    defaultPlaybackSpeed: 1.0,
    defaultVolume: 75,
    autoPlayNext: false,
    defaultTranscriptionLanguage: null,
    transcriptionQuality: "balanced" as const,
    dateTimeFormat: "relative" as const,
    recordingListSortOrder: "newest" as const,
    itemsPerPage: 50,
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
    "syncInterval",
    "autoSyncEnabled",
    "syncOnMount",
    "syncOnVisibilityChange",
    "syncNotifications",
    "defaultPlaybackSpeed",
    "defaultVolume",
    "autoPlayNext",
    "defaultTranscriptionLanguage",
    "transcriptionQuality",
    "dateTimeFormat",
    "recordingListSortOrder",
    "itemsPerPage",
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
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

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
    if (settings.titleGenerationPrompt) {
        settingsData.titleGenerationPrompt = settings.titleGenerationPrompt;
    }
    if (settings.summaryPrompt) {
        settingsData.summaryPrompt = settings.summaryPrompt;
    }
    return NextResponse.json({
        ...settingsData,
        userEmail,
    });
});

// PUT - Update user settings
export const PUT = apiHandler(async (request: Request) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

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

    // Handle titleGenerationPrompt separately (jsonb field)
    if (body.titleGenerationPrompt !== undefined) {
        updateData.titleGenerationPrompt = body.titleGenerationPrompt;
        insertData.titleGenerationPrompt = body.titleGenerationPrompt;
    } else if (!existing) {
        insertData.titleGenerationPrompt = null;
    }

    // Handle summaryPrompt separately (jsonb field)
    if (body.summaryPrompt !== undefined) {
        updateData.summaryPrompt = body.summaryPrompt;
        insertData.summaryPrompt = body.summaryPrompt;
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
