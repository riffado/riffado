import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings, transcriptions, userSettings } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { decryptText } from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

// GET - Export recordings in specified format
export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const { searchParams } = new URL(request.url);
    // Read the raw query param (may be null) so the user-settings
    // fallback below actually has a chance to apply. Defaulting `format`
    // to "json" up here would mask `settings.defaultExportFormat`
    // entirely.
    const formatParam = searchParams.get("format");

    // Get user settings for default format
    const [settings] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);

    const exportFormat = formatParam || settings?.defaultExportFormat || "json";

    // Get all recordings for user
    const userRecordings = await db
        .select()
        .from(recordings)
        .where(
            and(
                eq(recordings.userId, session.user.id),
                isNull(recordings.deletedAt),
            ),
        );

    // Get transcriptions for all recordings
    const recordingIds = userRecordings.map((r) => r.id);
    const userTranscriptions =
        recordingIds.length > 0
            ? await db
                  .select()
                  .from(transcriptions)
                  .where(eq(transcriptions.userId, session.user.id))
            : [];

    // Decrypt content fields up front so each format branch can rely on
    // plaintext. The export file is the user's plaintext data — they own
    // it once it leaves the server.
    const transcriptionMap = new Map(
        userTranscriptions.map((t) => [
            t.recordingId,
            { ...t, text: decryptText(t.text) },
        ]),
    );
    const decryptedRecordings = userRecordings.map((r) => ({
        ...r,
        filename: decryptText(r.filename),
    }));

    // Format export data
    let exportData: string;
    let contentType: string;
    let filename: string;

    switch (exportFormat) {
        case "json":
            exportData = JSON.stringify(
                decryptedRecordings.map((recording) => ({
                    id: recording.id,
                    filename: recording.filename,
                    duration: recording.duration,
                    startTime: recording.startTime,
                    filesize: recording.filesize,
                    transcription:
                        transcriptionMap.get(recording.id)?.text || null,
                })),
                null,
                2,
            );
            contentType = "application/json";
            filename = `recordings-${new Date().toISOString().split("T")[0]}.json`;
            break;

        case "txt":
            exportData = decryptedRecordings
                .map((recording) => {
                    const transcription = transcriptionMap.get(recording.id);
                    return `${recording.filename}\n${new Date(recording.startTime).toISOString()}\n${transcription?.text || "No transcription"}\n\n---\n\n`;
                })
                .join("");
            contentType = "text/plain";
            filename = `recordings-${new Date().toISOString().split("T")[0]}.txt`;
            break;

        case "srt":
            // SRT format for subtitles
            exportData = decryptedRecordings
                .map((recording, index) => {
                    const transcription = transcriptionMap.get(recording.id);
                    if (!transcription?.text) return "";
                    const startTime = new Date(recording.startTime);
                    const endTime = new Date(
                        startTime.getTime() + recording.duration,
                    );
                    const formatSRTTime = (date: Date) => {
                        const hours = date
                            .getUTCHours()
                            .toString()
                            .padStart(2, "0");
                        const minutes = date
                            .getUTCMinutes()
                            .toString()
                            .padStart(2, "0");
                        const seconds = date
                            .getUTCSeconds()
                            .toString()
                            .padStart(2, "0");
                        const ms = date
                            .getUTCMilliseconds()
                            .toString()
                            .padStart(3, "0");
                        return `${hours}:${minutes}:${seconds},${ms}`;
                    };
                    return `${index + 1}\n${formatSRTTime(startTime)} --> ${formatSRTTime(endTime)}\n${transcription.text}\n\n`;
                })
                .filter(Boolean)
                .join("");
            contentType = "text/plain";
            filename = `recordings-${new Date().toISOString().split("T")[0]}.srt`;
            break;

        case "vtt":
            // WebVTT format
            exportData = `WEBVTT\n\n${decryptedRecordings
                .map((recording) => {
                    const transcription = transcriptionMap.get(recording.id);
                    if (!transcription?.text) return "";
                    const startTime = new Date(recording.startTime);
                    const endTime = new Date(
                        startTime.getTime() + recording.duration,
                    );
                    const formatVTTTime = (date: Date) => {
                        const hours = date
                            .getUTCHours()
                            .toString()
                            .padStart(2, "0");
                        const minutes = date
                            .getUTCMinutes()
                            .toString()
                            .padStart(2, "0");
                        const seconds = date
                            .getUTCSeconds()
                            .toString()
                            .padStart(2, "0");
                        const ms = date
                            .getUTCMilliseconds()
                            .toString()
                            .padStart(3, "0");
                        return `${hours}:${minutes}:${seconds}.${ms}`;
                    };
                    return `${formatVTTTime(startTime)} --> ${formatVTTTime(endTime)}\n${transcription.text}\n\n`;
                })
                .filter(Boolean)
                .join("")}`;
            contentType = "text/vtt";
            filename = `recordings-${new Date().toISOString().split("T")[0]}.vtt`;
            break;

        default:
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "Invalid export format",
                400,
                { field: "format" },
            );
    }

    return new NextResponse(exportData, {
        headers: {
            "Content-Type": contentType,
            "Content-Disposition": `attachment; filename="${filename}"`,
        },
    });
});
