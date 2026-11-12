import type {
    PlaudContentItem,
    PlaudFileDetailResponse,
    PlaudRecording,
    PlaudV4FileDetailResponse,
    PlaudV4FileObject,
    PlaudV4RecordingItem,
} from "@/types/plaud";

/**
 * Status Plaud returns (HTTP 200, no payload) from every legacy `/file/...`
 * endpoint once an account is migrated to Plaud 4.0:
 * `{ "status": -1800907, "msg": "Account migrated to 4.0. Please update and reinitialize." }`.
 */
export const PLAUD_V4_MIGRATED_STATUS = -1800907;

/** `/file-app/v4/nodes/rename` with a stale `origin_version`. */
export const PLAUD_V4_VERSION_CONFLICT_STATUS = -1800313;

type PlaudV4FileDetail = NonNullable<PlaudV4FileDetailResponse["data"]>;

/** True for the "Account migrated to 4.0" envelope. */
export function isPlaudV4MigratedResponse(body: unknown): boolean {
    if (!body || typeof body !== "object") return false;
    const { status, msg } = body as { status?: unknown; msg?: unknown };
    if (status === PLAUD_V4_MIGRATED_STATUS) return true;
    return typeof msg === "string" && /migrated to 4\.0/i.test(msg);
}

/**
 * Riffado recording id for a v4 file id. v4 exposes pre-migration files as
 * `of_<legacy id>`: stripping the prefix keeps existing rows matched. New
 * files (`f_...`) keep their v4 id.
 */
export function plaudV4FileIdToRecordingId(fileId: string): string {
    return fileId.startsWith("of_") ? fileId.slice(3) : fileId;
}

/** Inverse of `plaudV4FileIdToRecordingId`. */
export function recordingIdToPlaudV4FileId(id: string): string {
    if (id.startsWith("f_") || id.startsWith("of_")) return id;
    return `of_${id}`;
}

/** UTC offset in minutes of an IANA zone at a given instant. */
export function timeZoneOffsetMinutes(
    timeZone: string | null | undefined,
    atMs: number,
): number | undefined {
    if (!timeZone) return undefined;
    try {
        const dtf = new Intl.DateTimeFormat("en-US", {
            timeZone,
            hourCycle: "h23",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
        const parts: Record<string, string> = {};
        for (const p of dtf.formatToParts(new Date(atMs))) {
            parts[p.type] = p.value;
        }
        const asUtc = Date.UTC(
            Number(parts.year),
            Number(parts.month) - 1,
            Number(parts.day),
            Number(parts.hour),
            Number(parts.minute),
            Number(parts.second),
        );
        const offset = Math.round(
            (asUtc - Math.floor(atMs / 1000) * 1000) / 60000,
        );
        return Number.isFinite(offset) ? offset : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Map a `/file-app/v4/recordings/all` item onto the legacy recording shape.
 * Device serial, size, md5 and content flags are absent from the listing:
 * `applyPlaudV4Detail` fills them from the file detail.
 */
export function mapPlaudV4Item(item: PlaudV4RecordingItem): PlaudRecording {
    const start = item.created_at_show_ms ?? 0;
    const duration = item.duration_ms ?? 0;
    const version = item.version_ms ?? item.updated_at_show_ms ?? start;
    return {
        id: plaudV4FileIdToRecordingId(item.file_id),
        filename: item.name ?? "",
        keywords: [],
        filesize: 0,
        filetype: "",
        fullname: "",
        file_md5: "",
        ori_ready: true,
        version: version,
        version_ms: version,
        edit_time: Math.max(item.updated_at_show_ms ?? 0, version),
        edit_from: "",
        is_trash: false,
        start_time: start,
        end_time: start + duration,
        duration,
        timezone: 0,
        zonemins: 0,
        scene: 0,
        filetag_id_list: [],
        serial_number: "",
        is_trans: false,
        is_summary: false,
        source: "v4",
    };
}

/**
 * Order v4 listings like the legacy `sort_by` / `is_desc` parameters.
 * `recordings/all` only sorts by creation, but sync expects most recently
 * edited first (it stops after unchanged pages).
 */
export function sortPlaudRecordings(
    recordings: PlaudRecording[],
    sortBy: string,
    isDesc: boolean,
): PlaudRecording[] {
    const byStart = sortBy === "start_time" || sortBy === "create_time";
    const key = (r: PlaudRecording) => (byStart ? r.start_time : r.edit_time);
    const dir = isDesc ? -1 : 1;
    return [...recordings].sort(
        (a, b) =>
            dir * (key(a) - key(b)) || dir * (a.start_time - b.start_time),
    );
}

function readyObject(
    detail: PlaudV4FileDetail | undefined,
    type: string,
): PlaudV4FileObject | undefined {
    return detail?.objects?.find(
        (o) =>
            o.object_type === type &&
            o.task_status === 1 &&
            Boolean(o.content_url || o.content_id),
    );
}

const AUDIO_OBJECT_TYPES = ["AUDIO_TRANSCODED", "AUDIO"];

/**
 * The audio object riffado downloads from a v4 file detail. `AUDIO_TRANSCODED`
 * (the MP3 the Plaud player streams) wins over `AUDIO` (the recorder upload,
 * not always a playable container); objects carrying a content URL or id win
 * over those that do not.
 */
export function selectPlaudV4Audio(
    detail: PlaudV4FileDetail | undefined,
): PlaudV4FileObject | undefined {
    const rank = (o: PlaudV4FileObject) =>
        (o.content_url || o.content_id ? 0 : AUDIO_OBJECT_TYPES.length) +
        AUDIO_OBJECT_TYPES.indexOf(o.object_type ?? "");
    return (detail?.objects ?? [])
        .filter((o) => AUDIO_OBJECT_TYPES.includes(o.object_type ?? ""))
        .sort((a, b) => rank(a) - rank(b))[0];
}

/** Fill device, size, timezone and content flags from a v4 file detail. */
export function applyPlaudV4Detail(
    recording: PlaudRecording,
    detail: PlaudV4FileDetail | undefined,
): PlaudRecording {
    if (!detail) return recording;
    const meta = detail.meta ?? {};
    const audio = selectPlaudV4Audio(detail);
    const metaSize =
        audio?.object_type === "AUDIO_TRANSCODED" ? undefined : meta.size_bytes;
    const start = meta.start_time ?? recording.start_time;
    const duration = meta.duration ?? recording.duration;
    const offset = timeZoneOffsetMinutes(meta.timezone_iana, start);
    return {
        ...recording,
        serial_number: meta.serial_number || recording.serial_number,
        filesize: audio?.object_size || metaSize || recording.filesize,
        start_time: start,
        end_time: start + duration,
        duration,
        timezone:
            offset !== undefined ? Math.trunc(offset / 60) : recording.timezone,
        zonemins: offset !== undefined ? offset % 60 : recording.zonemins,
        is_trans: Boolean(readyObject(detail, "TRANSCRIPT")),
        is_summary: Boolean(readyObject(detail, "SUMMARY")),
    };
}

const V4_CONTENT_TYPES: Record<string, string> = {
    TRANSCRIPT: "transaction",
    SUMMARY: "auto_sum_note",
};

/**
 * Express a v4 file detail as the legacy `/file/detail` content manifest, so
 * the Plaud-native import (`selectContentItems`, `parseTranscript`,
 * `parseSummary`) runs unchanged. v4 `TRANSCRIPT` / `SUMMARY` objects point
 * at the same `trans_result.json.gz` / `ai_content.md.gz` payloads.
 */
export function plaudV4DetailToLegacy(
    detail: PlaudV4FileDetail | undefined,
): PlaudFileDetailResponse {
    const contentList: PlaudContentItem[] = [];
    for (const o of detail?.objects ?? []) {
        const dataType = o.object_type && V4_CONTENT_TYPES[o.object_type];
        if (!dataType) continue;
        contentList.push({
            data_id: o.content_id ?? o.object_id,
            data_type: dataType,
            task_status: o.task_status ?? undefined,
            data_link: o.content_url ?? undefined,
        });
    }
    return {
        status: 0,
        data: {
            file_id: detail?.meta?.file_id,
            duration: detail?.meta?.duration,
            start_time: detail?.meta?.start_time,
            content_list: contentList,
            pre_download_content_list: [],
        },
    };
}
