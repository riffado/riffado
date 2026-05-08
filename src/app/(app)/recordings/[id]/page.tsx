import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { RecordingWorkstation } from "@/components/recordings/recording-workstation";
import { db } from "@/db";
import { recordings, transcriptions } from "@/db/schema";
import { requireAuth } from "@/lib/auth-server";
import { decryptText } from "@/lib/encryption/fields";

interface RecordingDetailPageProps {
    params: Promise<{ id: string }>;
}

export default async function RecordingDetailPage({
    params,
}: RecordingDetailPageProps) {
    // Check authentication server-side
    const session = await requireAuth();
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

    // Fetch transcription if exists
    const [transcription] = await db
        .select()
        .from(transcriptions)
        .where(eq(transcriptions.recordingId, id))
        .limit(1);

    // Content fields are encrypted at rest; decrypt server-side before
    // handing off to the client component.
    return (
        <RecordingWorkstation
            recording={{
                ...recording,
                filename: decryptText(recording.filename),
                startTime: recording.startTime.toISOString(),
            }}
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
