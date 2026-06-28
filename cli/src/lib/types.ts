/**
 * Wire types mirroring `src/lib/v1/serialize.ts` server-side. Kept hand-
 * written (not imported from `src/`) because the CLI ships as a
 * standalone npm package and must not pull in server modules.
 *
 * If the server's `/api/v1` shape ever changes, update both ends in the
 * same PR — there is no `@riffado/types` package today.
 */

export type V1Transcript = {
    language: string | null;
    text: string;
    provider: string;
    model: string;
    created_at: string;
};

export type V1Summary = {
    text: string | null;
    action_items: string[] | null;
    key_points: string[] | null;
    provider: string;
    model: string;
    created_at: string;
};

export type V1Recording = {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    recorded_at: string;
    duration_ms: number;
    filesize_bytes: number;
    device: {
        serial_number: string;
        name: string | null;
        model: string | null;
    } | null;
    has_transcription: boolean;
    has_summary: boolean;
    links: {
        self: string;
        transcript: string;
        audio: string;
    };
};

export type V1RecordingDetail = V1Recording & {
    transcript: V1Transcript | null;
    summary: V1Summary | null;
};

export type V1RecordingsList = {
    data: V1Recording[];
    next_cursor: string | null;
    has_more: boolean;
};
