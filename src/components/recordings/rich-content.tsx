"use client";

import {
    type JSX,
    type ReactNode,
    useCallback,
    useMemo,
    useState,
} from "react";
import { Input } from "@/components/ui/input";
import type { SpeakerNameMap } from "@/types/speaker";

function isSafeImageSrc(src: string): boolean {
    return src.startsWith("/api/plaud-assets/") || src.startsWith("https://");
}

// Inline markdown: bold, italic, inline code, strikethrough, and links.
function renderInline(text: string, keyPrefix: string): ReactNode[] {
    const nodes: ReactNode[] = [];
    // Ordered so the first match at a position wins.
    const pattern =
        /(\*\*([^*]+)\*\*)|(~~([^~]+)~~)|(`([^`]+)`)|(\*([^*]+)\*)|(_([^_]+)_)|(\[([^\]]+)\]\(([^)]+)\))/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex loop
    while ((m = pattern.exec(text)) !== null) {
        if (m.index > last) nodes.push(text.slice(last, m.index));
        const k = `${keyPrefix}-i${i++}`;
        if (m[1]) nodes.push(<strong key={k}>{m[2]}</strong>);
        else if (m[3])
            nodes.push(
                <del key={k} className="opacity-70">
                    {m[4]}
                </del>,
            );
        else if (m[5])
            nodes.push(
                <code
                    key={k}
                    className="rounded bg-black/20 px-1 py-0.5 font-mono text-[0.85em]"
                >
                    {m[6]}
                </code>,
            );
        else if (m[7]) nodes.push(<em key={k}>{m[8]}</em>);
        else if (m[9]) nodes.push(<em key={k}>{m[10]}</em>);
        else if (m[11]) {
            const href = m[13];
            // Same-origin paths and https only. A leading "//" (or "/\") is
            // protocol-relative and resolves to an EXTERNAL host, so it must not
            // pass the "/" check.
            const safe =
                href.startsWith("https://") ||
                (href.startsWith("/") &&
                    !href.startsWith("//") &&
                    !href.startsWith("/\\"));
            nodes.push(
                safe ? (
                    <a
                        key={k}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-cyan underline underline-offset-2"
                    >
                        {m[12]}
                    </a>
                ) : (
                    m[12]
                ),
            );
        }
        last = pattern.lastIndex;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
}

const HR_RE = /^\s*([-*_])\1{2,}\s*$/; // ---, ***, ___ (3+)
const IMG_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const CHECK_RE = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;

/**
 * Render the markdown subset Plaud emits in summaries: headings, bold,
 * italic, strikethrough, inline code, bullet/ordered/checkbox lists,
 * blockquotes, horizontal rules, links, and images.
 *
 * Output is built from React elements, never `dangerouslySetInnerHTML`, so
 * every text run is auto-escaped. Image sources are restricted to
 * same-origin asset routes and `https:`, and link hrefs to `https:` and
 * same-origin paths, so summary content cannot introduce a `data:` or
 * `javascript:` URL. Anything unrecognised falls through as plain text.
 */
export function RichMarkdown({
    content,
    className,
}: {
    content: string;
    className?: string;
}): JSX.Element {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const blocks: ReactNode[] = [];
    let para: string[] = [];
    let list: {
        ordered: boolean;
        items: { text: string; check?: boolean }[];
    } | null = null;
    let quote: string[] = [];
    let b = 0;

    const flushPara = () => {
        if (para.length) {
            const key = `p${b++}`;
            blocks.push(
                <p key={key} className="leading-relaxed my-2">
                    {renderInline(para.join(" "), key)}
                </p>,
            );
            para = [];
        }
    };
    const flushList = () => {
        if (list) {
            const key = `l${b++}`;
            const ordered = list.ordered;
            const items = list.items.map((it, idx) => {
                // An ordered list keeps its native list-decimal marker, so it must NOT
                // become a flex row and must not get a bullet injected - either would
                // suppress the number. Only unordered rows use the flex + marker layout.
                const marker =
                    it.check !== undefined ? (
                        <input
                            type="checkbox"
                            checked={it.check}
                            readOnly
                            className="mt-1.5 shrink-0 accent-accent-cyan"
                        />
                    ) : ordered ? null : (
                        <span className="mt-1.5 size-1.5 rounded-full bg-accent-cyan shrink-0" />
                    );
                return (
                    <li
                        // biome-ignore lint/suspicious/noArrayIndexKey: parsed output is rebuilt from scratch on every render and never reordered
                        key={`${key}-${idx}`}
                        className={
                            marker
                                ? "leading-relaxed flex gap-2 items-start"
                                : "leading-relaxed"
                        }
                    >
                        {marker}
                        {marker ? (
                            <span>
                                {renderInline(it.text, `${key}-${idx}`)}
                            </span>
                        ) : (
                            renderInline(it.text, `${key}-${idx}`)
                        )}
                    </li>
                );
            });
            blocks.push(
                ordered ? (
                    <ol key={key} className="my-2 space-y-1 list-decimal pl-5">
                        {items}
                    </ol>
                ) : (
                    <ul key={key} className="my-2 space-y-1">
                        {items}
                    </ul>
                ),
            );
            list = null;
        }
    };
    const flushQuote = () => {
        if (quote.length) {
            const key = `q${b++}`;
            blocks.push(
                <blockquote
                    key={key}
                    className="my-2 border-l-2 border-accent-cyan/60 pl-3 italic text-muted-foreground"
                >
                    {renderInline(quote.join(" "), key)}
                </blockquote>,
            );
            quote = [];
        }
    };
    const flushAll = () => {
        flushPara();
        flushList();
        flushQuote();
    };

    for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line.trim()) {
            flushAll();
            continue;
        }

        const img = line.match(IMG_RE);
        if (img && isSafeImageSrc(img[2])) {
            flushAll();
            blocks.push(
                // biome-ignore lint/performance/noImgElement: remote object-storage asset behind an auth-gated route, not a bundled static asset next/image can optimize
                <img
                    key={`img${b++}`}
                    src={img[2]}
                    alt={img[1] || "summary graphic"}
                    className="my-3 max-w-full rounded-lg border border-border"
                    loading="lazy"
                />,
            );
            continue;
        }

        if (HR_RE.test(line)) {
            flushAll();
            blocks.push(<hr key={`hr${b++}`} className="my-4 border-border" />);
            continue;
        }

        const h = line.match(HEADING_RE);
        if (h) {
            flushAll();
            const level = Math.min(h[1].length, 6);
            const key = `h${b++}`;
            const inner = renderInline(h[2], key);
            const cls: Record<number, string> = {
                1: "text-xl font-bold mt-4 mb-2",
                2: "text-lg font-semibold mt-4 mb-2",
                3: "text-base font-semibold mt-3 mb-1",
                4: "text-sm font-semibold mt-2 mb-1",
                5: "text-sm font-medium mt-2 mb-1",
                6: "text-xs font-medium uppercase tracking-wide mt-2 mb-1",
            };
            const c = cls[level];
            blocks.push(
                level === 1 ? (
                    <h1 key={key} className={c}>
                        {inner}
                    </h1>
                ) : level === 2 ? (
                    <h2 key={key} className={c}>
                        {inner}
                    </h2>
                ) : level === 3 ? (
                    <h3 key={key} className={c}>
                        {inner}
                    </h3>
                ) : level === 4 ? (
                    <h4 key={key} className={c}>
                        {inner}
                    </h4>
                ) : level === 5 ? (
                    <h5 key={key} className={c}>
                        {inner}
                    </h5>
                ) : (
                    <h6 key={key} className={c}>
                        {inner}
                    </h6>
                ),
            );
            continue;
        }

        const q = line.match(QUOTE_RE);
        if (q) {
            flushPara();
            flushList();
            quote.push(q[1]);
            continue;
        }
        flushQuote();

        const chk = line.match(CHECK_RE);
        if (chk) {
            flushPara();
            if (!list || list.ordered) {
                flushList();
                list = { ordered: false, items: [] };
            }
            list.items.push({
                text: chk[2],
                check: chk[1].toLowerCase() === "x",
            });
            continue;
        }
        const bul = line.match(BULLET_RE);
        if (bul) {
            flushPara();
            if (!list || list.ordered) {
                flushList();
                list = { ordered: false, items: [] };
            }
            list.items.push({ text: bul[1] });
            continue;
        }
        const ord = line.match(ORDERED_RE);
        if (ord) {
            flushPara();
            if (!list || !list.ordered) {
                flushList();
                list = { ordered: true, items: [] };
            }
            list.items.push({ text: ord[1] });
            continue;
        }

        flushList();
        para.push(line.trim());
    }
    flushAll();

    return <div className={className}>{blocks}</div>;
}

// Only the diarization label formats this app actually emits — `SPEAKER_00`
// (WhisperX), `Speaker 1` (Plaud), and the `UNKNOWN` fallback. A generic
// `Capitalized:` pattern would misread an ordinary transcript line such as
// `Question: ...` or `Action item: ...` as a speaker turn and wrongly switch a
// non-diarized transcript out of its plain-text fallback.
const SPEAKER_RE = /^(SPEAKER_\w+|Speaker\s+\w+|UNKNOWN):\s*(.*)$/;

const SPEAKER_COLORS = [
    "text-accent-cyan",
    "text-emerald-400",
    "text-amber-400",
    "text-violet-400",
    "text-rose-400",
    "text-sky-400",
];

const MAX_SPEAKER_NAME_LENGTH = 200;

interface SpeakerTurn {
    speaker: string | null;
    text: string;
}

function parseSpeakerTurns(text: string): SpeakerTurn[] {
    const lines = text
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

    const turns: SpeakerTurn[] = [];
    for (const line of lines) {
        const m = line.match(SPEAKER_RE);
        if (m) turns.push({ speaker: m[1], text: m[2] });
        else if (turns.length && turns[turns.length - 1].speaker === null)
            turns[turns.length - 1].text += ` ${line}`;
        else turns.push({ speaker: null, text: line });
    }
    return turns;
}

/**
 * Render a diarized transcript as one block per speaker turn, colouring
 * each speaker label consistently in order of first appearance.
 *
 * Plaud transcripts arrive as `SPEAKER_00: ...` / `Speaker 1: ...` lines,
 * one turn per line. A line with no recognised label is appended to the
 * preceding unlabelled turn. When no line carries a label at all (a plain
 * Whisper transcript, for example) the whole text is rendered as
 * pre-wrapped plain text.
 *
 * `speakerNames` swaps the raw diarization label for a human name at
 * render time. The transcript text is never rewritten, so the label stays
 * the stable key, and colours are assigned from that raw label so a
 * speaker's colour survives a rename.
 *
 * Supplying `onRenameSpeaker` turns each label into a click-to-edit chip:
 * Enter saves, Escape cancels, and saving an empty value clears the name.
 * Without it the labels render read-only.
 */
export function SpeakerTranscript({
    text,
    className,
    speakerNames,
    onRenameSpeaker,
}: {
    text: string;
    className?: string;
    speakerNames?: SpeakerNameMap;
    onRenameSpeaker?: (speakerLabel: string, displayName: string) => void;
}): JSX.Element {
    const [editingTurn, setEditingTurn] = useState<number | null>(null);
    const [draft, setDraft] = useState("");

    const turns = useMemo(() => parseSpeakerTurns(text), [text]);

    const colorByLabel = useMemo(() => {
        const colors: Record<string, string> = {};
        let assigned = 0;
        for (const turn of turns) {
            if (!turn.speaker || colors[turn.speaker]) continue;
            colors[turn.speaker] =
                SPEAKER_COLORS[assigned++ % SPEAKER_COLORS.length];
        }
        return colors;
    }, [turns]);

    // Stable identity so React only re-attaches (and re-focuses) the ref
    // when the input actually mounts, not on every keystroke.
    const focusOnMount = useCallback((el: HTMLInputElement | null) => {
        el?.focus();
        el?.select();
    }, []);

    const hasSpeakers = turns.some((t) => t.speaker !== null);
    if (!hasSpeakers) {
        return (
            <p
                className={`whitespace-pre-wrap leading-relaxed ${className ?? ""}`}
            >
                {text}
            </p>
        );
    }

    const editable = typeof onRenameSpeaker === "function";

    const startEditing = (index: number, label: string) => {
        setDraft(speakerNames?.[label]?.displayName ?? "");
        setEditingTurn(index);
    };

    const commit = (label: string) => {
        setEditingTurn(null);
        onRenameSpeaker?.(label, draft);
    };

    return (
        <div className={`space-y-3 ${className ?? ""}`}>
            {turns.map((t, i) => {
                const label = t.speaker;
                if (!label) {
                    return (
                        // biome-ignore lint/suspicious/noArrayIndexKey: turns are reparsed from the transcript on every render and never reordered
                        <div key={`turn-${i}`} className="leading-relaxed">
                            <span>{t.text}</span>
                        </div>
                    );
                }

                const stored = speakerNames?.[label];
                const isAuto = stored?.source === "auto";
                const shown = stored?.displayName ?? label;
                const color = colorByLabel[label] ?? SPEAKER_COLORS[0];
                const confidence =
                    isAuto && typeof stored?.confidence === "number"
                        ? ` ${Math.round(stored.confidence * 100)}% match.`
                        : "";

                return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: turns are reparsed from the transcript on every render and never reordered
                    <div key={`turn-${i}`} className="leading-relaxed">
                        {editingTurn === i ? (
                            <Input
                                ref={focusOnMount}
                                value={draft}
                                placeholder={label}
                                maxLength={MAX_SPEAKER_NAME_LENGTH}
                                aria-label={`Name for ${label}`}
                                className="mr-2 inline-flex h-6 w-44 px-2 py-0 text-sm md:text-sm"
                                onChange={(e) => setDraft(e.target.value)}
                                onBlur={() => setEditingTurn(null)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        commit(label);
                                    } else if (e.key === "Escape") {
                                        e.preventDefault();
                                        setEditingTurn(null);
                                    }
                                }}
                            />
                        ) : (
                            <span
                                className={`mr-2 inline-flex items-baseline gap-1 ${color}`}
                            >
                                {editable ? (
                                    <button
                                        type="button"
                                        onClick={() => startEditing(i, label)}
                                        title={`${label}.${confidence} Click to rename.`}
                                        className={`cursor-pointer rounded font-semibold hover:underline focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none ${color} ${
                                            isAuto ? "opacity-80" : ""
                                        }`}
                                    >
                                        {shown}:
                                    </button>
                                ) : (
                                    <span
                                        className={`font-semibold ${color} ${
                                            isAuto ? "opacity-80" : ""
                                        }`}
                                    >
                                        {shown}:
                                    </span>
                                )}
                                {isAuto && (
                                    <span
                                        title={`Matched by voice.${confidence}`}
                                        className="text-[10px] tracking-wide text-muted-foreground uppercase"
                                    >
                                        auto
                                    </span>
                                )}
                            </span>
                        )}
                        <span>{t.text}</span>
                    </div>
                );
            })}
        </div>
    );
}
