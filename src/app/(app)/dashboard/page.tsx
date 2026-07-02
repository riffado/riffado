import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { Workstation } from "@/components/dashboard/workstation";
import { db } from "@/db";
import {
    aiEnhancements,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import { requireAuth } from "@/lib/auth-server";
import { decryptText } from "@/lib/encryption/fields";
import { env } from "@/lib/env";
import { isAdminEmail } from "@/lib/hosted/admin/guard";
import { initialSettingsFromRow } from "@/lib/settings/initial-settings";
import { serializeRecording } from "@/types/recording";

export default async function DashboardPage() {
    const session = await requireAuth();

    const [userRecordings, userTranscriptions, userSummaryRows, [settingsRow]] =
        await Promise.all([
            db
                .select({
                    id: recordings.id,
                    filename: recordings.filename,
                    duration: recordings.duration,
                    startTime: recordings.startTime,
                    filesize: recordings.filesize,
                    deviceSn: recordings.deviceSn,
                    waveformPeaks: recordings.waveformPeaks,
                })
                .from(recordings)
                .where(
                    and(
                        eq(recordings.userId, session.user.id),
                        isNull(recordings.deletedAt),
                    ),
                )
                .orderBy(desc(recordings.startTime)),
            db
                .select({
                    recordingId: transcriptions.recordingId,
                    text: transcriptions.text,
                    language: transcriptions.detectedLanguage,
                })
                .from(transcriptions)
                .where(eq(transcriptions.userId, session.user.id)),
            // We only need to know IF a summary exists per recording for the
            // list status chip — the full summary is still fetched on
            // selection by the existing /api/recordings/[id]/summary route.
            db
                .select({ recordingId: aiEnhancements.recordingId })
                .from(aiEnhancements)
                .where(
                    and(
                        eq(aiEnhancements.userId, session.user.id),
                        isNotNull(aiEnhancements.summary),
                    ),
                ),
            // Load user settings server-side so the Workstation, list, and
            // player render with the user's preferences on first paint — no
            // waterfall of /api/settings/user fetches from three different
            // components.
            db
                .select()
                .from(userSettings)
                .where(eq(userSettings.userId, session.user.id))
                .limit(1),
        ]);
    const summaryIds = new Set(userSummaryRows.map((r) => r.recordingId));
    const transcriptIds = new Set(userTranscriptions.map((t) => t.recordingId));

    // Content fields are encrypted at rest; decrypt server-side (this is
    // an RSC — client never sees a key) before serializing for the
    // workstation. Legacy plaintext rows pass through verbatim.
    const recordingsData = userRecordings.map(({ waveformPeaks, ...r }) =>
        serializeRecording(
            { ...r, filename: decryptText(r.filename) },
            {
                hasTranscript: transcriptIds.has(r.id),
                hasSummary: summaryIds.has(r.id),
                // jsonb comes back already-parsed; coerce to the typed shape.
                waveformPeaks: Array.isArray(waveformPeaks)
                    ? (waveformPeaks as number[])
                    : null,
            },
        ),
    );

    const transcriptionMap = new Map(
        userTranscriptions.map((t) => [
            t.recordingId,
            { text: decryptText(t.text), language: t.language || undefined },
        ]),
    );

    // One source of truth for InitialSettings + their defaults lives in
    // `src/lib/settings/initial-settings.ts`; adding a new preference
    // there is the only place callers need to touch.
    const initialSettings = initialSettingsFromRow(settingsRow);

    return (
        <Workstation
            recordings={recordingsData}
            transcriptions={transcriptionMap}
            isAdmin={isAdminEmail(session.user.email)}
            userEmail={session.user.email ?? null}
            initialSettings={initialSettings}
            isHosted={env.IS_HOSTED}
        />
    );
}
