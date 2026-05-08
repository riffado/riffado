import { and, desc, eq, isNull } from "drizzle-orm";
import { Workstation } from "@/components/dashboard/workstation";
import { db } from "@/db";
import { recordings, transcriptions } from "@/db/schema";
import { isAdminEmail } from "@/lib/admin/guard";
import { requireAuth } from "@/lib/auth-server";
import { decryptText } from "@/lib/encryption/fields";
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

    // Content fields are encrypted at rest; decrypt server-side (this is
    // an RSC — client never sees a key) before serializing for the
    // workstation. Legacy plaintext rows pass through verbatim.
    const recordingsData = userRecordings.map((r) =>
        serializeRecording({ ...r, filename: decryptText(r.filename) }),
    );

    const transcriptionMap = new Map(
        userTranscriptions.map((t) => [
            t.recordingId,
            { text: decryptText(t.text), language: t.language || undefined },
        ]),
    );

    return (
        <Workstation
            recordings={recordingsData}
            transcriptions={transcriptionMap}
            isAdmin={isAdminEmail(session.user.email)}
        />
    );
}
