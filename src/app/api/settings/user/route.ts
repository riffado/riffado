import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { normalizeAiOutputLanguage } from "@/lib/ai/summary-presets";
import { requireApiSession } from "@/lib/auth-server";
import { decryptJsonField, encryptJsonField } from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

// Enum allowlists. DB columns are `varchar`, not pg enums, so validation
// must happen here.
const ENUM_FIELDS = {
    playerScrubber: ["waveform", "slider"],
    listDensity: ["comfortable", "compact"],
    theme: ["light", "dark", "system"],
    dateTimeFormat: ["relative", "absolute", "iso"],
    recordingListSortOrder: ["newest", "oldest", "name"],
    transcriptionQuality: ["fast", "balanced", "accurate"],
    defaultExportFormat: ["json", "csv", "zip"],
    transcriptMode: ["plaud_only", "keep_both"],
    preferredTranscriptSource: ["plaud", "riffado"],
} as const satisfies Record<string, readonly string[]>;

const ENUM_FIELD_SETS: Record<string, ReadonlySet<string>> = Object.fromEntries(
    Object.entries(ENUM_FIELDS).map(([k, v]) => [k, new Set(v)]),
);

const DEFAULT_SETTINGS = {
    autoTranscribe: false,
    syncInterval: 300000,
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
    importPlaudContent: false,
    transcriptMode: "plaud_only" as const,
    preferredTranscriptSource: "plaud" as const,
} as const;

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
    "importPlaudContent",
    "transcriptMode",
    "preferredTranscriptSource",
] as const;

function extractSettings(settings: typeof userSettings.$inferSelect) {
    const result: Record<string, unknown> = {};
    for (const field of SETTINGS_FIELDS) {
        result[field] = settings[field];
    }
    result.barkPushUrl = settings.barkPushUrl || null;
    result.barkPushUrlSet = !!settings.barkPushUrl;
    return result;
}

export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const [settings] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);

    const userEmail = session.user.email || "";

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

export const PUT = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const body = await request.json();

    const [existing] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    const insertData: Record<string, unknown> = {
        userId: session.user.id,
    };

    for (const field of SETTINGS_FIELDS) {
        let value = body[field];
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
            insertData[field] = DEFAULT_SETTINGS[field];
        }
    }

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
