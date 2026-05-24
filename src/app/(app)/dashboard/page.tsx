import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { Workstation } from "@/components/dashboard/workstation";
import { db } from "@/db";
import {
    aiEnhancements,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import { isAdminEmail } from "@/lib/admin/guard";
import { requireAuth } from "@/lib/auth-server";
import { decryptText } from "@/lib/encryption/fields";
import { env } from "@/lib/env";
import { initialSettingsFromRow } from "@/lib/settings/initial-settings";
import { serializeRecording } from "@/types/recording";

export default async function DashboardPage() {
    const session = await requireAuth();

    const userRecordings = await db
        .select({
            id: recordings.id,
            filename: recordings.filename,
            duration: recordings.duration,
            startTime: recordings.startTime,
            filesize: recordings.filesize,
            deviceSn: recordings.deviceSn,
            waveformPeaks: recordings.waveformPeaks,
            transcribingStartedAt: recordings.transcribingStartedAt,
            transcriptionProgressSeconds:
                recordings.transcriptionProgressSeconds,
        })
        .from(recordings)
        .where(
            and(
                eq(recordings.userId, session.user.id),
                isNull(recordings.deletedAt),
            ),
        )
        .orderBy(desc(recordings.startTime));

    const userTranscriptions = await db
        .select({
            recordingId: transcriptions.recordingId,
            text: transcriptions.text,
            language: transcriptions.detectedLanguage,
        })
        .from(transcriptions)
        .where(eq(transcriptions.userId, session.user.id));

    // We only need to know IF a summary exists per recording for the list
    // status chip — the full summary is still fetched on selection by the
    // existing /api/recordings/[id]/summary route.
    const userSummaryRows = await db
        .select({ recordingId: aiEnhancements.recordingId })
        .from(aiEnhancements)
        .where(
            and(
                eq(aiEnhancements.userId, session.user.id),
                isNotNull(aiEnhancements.summary),
            ),
        );
    const summaryIds = new Set(userSummaryRows.map((r) => r.recordingId));
    const transcriptIds = new Set(userTranscriptions.map((t) => t.recordingId));

    // Mirror of TRANSCRIPTION_STALE_TIMEOUT_MS in transcribe-recording.ts
    // and lib/v1/serialize.ts. Kept local rather than imported because
    // page.tsx is an RSC and pulling in the worker module would drag the
    // OpenAI SDK + storage drivers into the server bundle. Three copies
    // is the lesser evil; keep them in sync.
    const TRANSCRIPTION_STALE_TIMEOUT_MS = 3 * 60 * 60 * 1000;
    const nowMs = Date.now();

    // Content fields are encrypted at rest; decrypt server-side (this is
    // an RSC — client never sees a key) before serializing for the
    // workstation. Legacy plaintext rows pass through verbatim.
    const recordingsData = userRecordings.map(
        ({
            waveformPeaks,
            transcribingStartedAt,
            transcriptionProgressSeconds,
            ...r
        }) => {
            const transcriptionInProgress = Boolean(
                transcribingStartedAt &&
                    nowMs - transcribingStartedAt.getTime() <
                        TRANSCRIPTION_STALE_TIMEOUT_MS,
            );
            return serializeRecording(
                { ...r, filename: decryptText(r.filename) },
                {
                    hasTranscript: transcriptIds.has(r.id),
                    hasSummary: summaryIds.has(r.id),
                    // jsonb comes back already-parsed; coerce to the typed shape.
                    waveformPeaks: Array.isArray(waveformPeaks)
                        ? (waveformPeaks as number[])
                        : null,
                    transcriptionInProgress,
                    // Drop a leftover progress value from a previous run
                    // that never got cleaned up (e.g. app killed mid-write
                    // of the release) — otherwise the UI would show a
                    // stale percentage on a recording that isn't running.
                    transcriptionProgressSeconds: transcriptionInProgress
                        ? transcriptionProgressSeconds
                        : null,
                },
            );
        },
    );

    const transcriptionMap = new Map(
        userTranscriptions.map((t) => [
            t.recordingId,
            { text: decryptText(t.text), language: t.language || undefined },
        ]),
    );

    // Load user settings server-side so the Workstation, list, and player
    // can render with the user's preferences on first paint — no waterfall
    // of /api/settings/user fetches from three different components.
    const [settingsRow] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);

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
