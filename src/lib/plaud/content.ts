import type {
    PlaudContentItem,
    PlaudFileDetailResponse,
    PlaudTranscriptSegment,
} from "@/types/plaud";

/**
 * Pure parsers for Plaud-native content (`GET /file/detail/{fileId}` →
 * `content_list[]`, plus the presigned-link payloads). No network or client
 * dependency, so they're unit-testable against fixtures.
 *
 * The content shapes are reverse-engineered and UNVERIFIED against official
 * Plaud docs (see #204 / Phase 0) — every parser is deliberately defensive and
 * tolerates missing/renamed fields rather than throwing.
 */

const TRANSCRIPT_TYPES = new Set(["transaction", "transcript"]);
const SUMMARY_TYPES = new Set(["summary", "note", "ai_summary"]);

export interface SelectedContent {
    transcript?: PlaudContentItem;
    summary?: PlaudContentItem;
}

/** First transcript-like and first summary-like item from `content_list`. */
export function selectContentItems(
    detail: PlaudFileDetailResponse,
): SelectedContent {
    const items = detail.data?.content_list ?? [];
    const selected: SelectedContent = {};
    for (const item of items) {
        const type = (item.data_type ?? "").toLowerCase();
        if (!selected.transcript && TRANSCRIPT_TYPES.has(type)) {
            selected.transcript = item;
        } else if (!selected.summary && SUMMARY_TYPES.has(type)) {
            selected.summary = item;
        }
    }
    return selected;
}

/**
 * A content item is importable only when Plaud has finished processing it
 * (`task_status === 1`) and it actually carries a fetchable link.
 */
export function isReady(item: PlaudContentItem | undefined): boolean {
    return Boolean(item && item.task_status === 1 && item.data_link);
}

export interface ParsedTranscript {
    text: string;
    segments: PlaudTranscriptSegment[];
    language: string | null;
}

/**
 * Parse a 'transaction' content payload into flattened, speaker-prefixed text
 * plus the structured segments. Accepts either a bare segment array or an
 * object that wraps one.
 */
export function parseTranscript(raw: unknown): ParsedTranscript {
    const segments = extractSegments(raw);
    const text = segments
        .map((seg) => {
            const content = (seg.content ?? "").trim();
            if (!content) return "";
            if (
                seg.speaker === undefined ||
                seg.speaker === null ||
                seg.speaker === ""
            ) {
                return content;
            }
            const label =
                typeof seg.speaker === "number"
                    ? `Speaker ${seg.speaker}`
                    : seg.speaker;
            return `${label}: ${content}`;
        })
        .filter(Boolean)
        .join("\n");
    return { text, segments, language: extractLanguage(raw) };
}

export interface ParsedSummary {
    summary: string;
    keyPoints: string[];
    actionItems: string[];
}

/**
 * Parse a 'summary'/'note' content payload. Accepts a bare string or an object
 * keyed by any of several known field names.
 */
export function parseSummary(raw: unknown): ParsedSummary {
    if (typeof raw === "string") {
        return { summary: raw.trim(), keyPoints: [], actionItems: [] };
    }
    if (!raw || typeof raw !== "object") {
        return { summary: "", keyPoints: [], actionItems: [] };
    }
    const obj = raw as Record<string, unknown>;
    const summary =
        pickString(obj.ai_content) ??
        pickString(obj.summary) ??
        pickString(obj.content) ??
        "";
    return {
        summary: summary.trim(),
        keyPoints: pickStringArray(
            obj.key_points ?? obj.keyPoints ?? obj.highlights,
        ),
        actionItems: pickStringArray(
            obj.action_items ?? obj.actionItems ?? obj.todos,
        ),
    };
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function extractSegments(raw: unknown): PlaudTranscriptSegment[] {
    let arr: unknown[] = [];
    if (Array.isArray(raw)) {
        arr = raw;
    } else if (raw && typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        arr =
            asArray(obj.segments).length > 0
                ? asArray(obj.segments)
                : asArray(obj.transcript).length > 0
                  ? asArray(obj.transcript)
                  : asArray(obj.data);
    }
    return arr
        .filter(
            (s): s is Record<string, unknown> =>
                Boolean(s) && typeof s === "object",
        )
        .map((s) => ({
            start_time:
                typeof s.start_time === "number" ? s.start_time : undefined,
            end_time: typeof s.end_time === "number" ? s.end_time : undefined,
            speaker:
                typeof s.speaker === "string" || typeof s.speaker === "number"
                    ? s.speaker
                    : undefined,
            content:
                typeof s.content === "string"
                    ? s.content
                    : typeof s.text === "string"
                      ? s.text
                      : undefined,
        }));
}

function extractLanguage(raw: unknown): string | null {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const lang = (raw as Record<string, unknown>).language;
        if (typeof lang === "string" && lang.trim()) return lang.trim();
    }
    return null;
}

function pickString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function pickStringArray(value: unknown): string[] {
    return asArray(value).filter((v): v is string => typeof v === "string");
}
