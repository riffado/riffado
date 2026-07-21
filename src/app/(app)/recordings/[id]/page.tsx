import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { RecordingWorkstation } from "@/components/recordings/recording-workstation";
import { db } from "@/db";
import { recordings, transcriptions, userSettings } from "@/db/schema";
import { requireAuth, requireCompletedOnboarding } from "@/lib/auth-server";
import { decryptText } from "@/lib/encryption/fields";

interface RecordingDetailPageProps {
    params: Promise<{ id: string }>;
}

export default async function RecordingDetailPage({
    params,
}: RecordingDetailPageProps) {
    // Check authentication server-side
    const session = await requireAuth();
    await requireCompletedOnboarding(session);
    const { id } = await params;

    // Fetch recording from database
    const [recording] = await db
        .select()
        .from(recordings)
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, session.user.id),
                isNull(recordings.deletedAt),
            ),
        )
        .limit(1);

    if (!recording) {
        notFound();
    }

    // Load player preferences server-side so the embedded
    // RecordingPlayer respects the user's saved volume / speed /
    // auto-play / scrubber choices. Without this, the legacy
    // /recordings/[id] route fell back to the player's hard-coded
    // 75 / 1x / false defaults regardless of what the user picked
    // in Settings → Playback (the dashboard route already plumbs
    // these through Workstation).
    const [[transcription], [settingsRow]] = await Promise.all([
        db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1),
        db
            .select({
                defaultPlaybackSpeed: userSettings.defaultPlaybackSpeed,
                defaultVolume: userSettings.defaultVolume,
                autoPlayNext: userSettings.autoPlayNext,
                playerScrubber: userSettings.playerScrubber,
            })
            .from(userSettings)
            .where(eq(userSettings.userId, session.user.id))
            .limit(1),
    ]);
    const scrubberStyle: "waveform" | "slider" =
        settingsRow?.playerScrubber === "slider" ? "slider" : "waveform";

    // Content fields are encrypted at rest; decrypt server-side before
    // handing off to the client component.
    // jsonb fields come back typed as `unknown` from drizzle; narrow to
    // the Recording shape's `number[] | null` here once, server-side.
    const waveformPeaks = Array.isArray(recording.waveformPeaks)
        ? (recording.waveformPeaks as number[])
        : null;

    return (
        <RecordingWorkstation
            recording={{
                ...recording,
                filename: decryptText(recording.filename),
                startTime: recording.startTime.toISOString(),
                waveformPeaks,
            }}
            initialPlaybackSpeed={settingsRow?.defaultPlaybackSpeed ?? 1.0}
            initialVolume={settingsRow?.defaultVolume ?? 75}
            initialAutoPlayNext={settingsRow?.autoPlayNext ?? false}
            scrubberStyle={scrubberStyle}
            transcription={
                transcription
                    ? {
                          text: decryptText(transcription.text),
                          detectedLanguage:
                              transcription.detectedLanguage || undefined,
                          transcriptionType: transcription.transcriptionType,
                      }
                    : undefined
            }
        />
    );
}
