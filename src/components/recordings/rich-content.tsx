"use client";

import type { JSX, ReactNode } from "react";

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
            const safe = href.startsWith("https://") || href.startsWith("/");
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
            const items = list.items.map((it, idx) => (
                <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: parsed output is rebuilt from scratch on every render and never reordered
                    key={`${key}-${idx}`}
                    className="leading-relaxed flex gap-2 items-start"
                >
                    {it.check !== undefined && (
                        <input
                            type="checkbox"
                            checked={it.check}
                            readOnly
                            className="mt-1.5 shrink-0 accent-accent-cyan"
                        />
                    )}
                    {it.check === undefined && (
                        <span className="mt-1.5 size-1.5 rounded-full bg-accent-cyan shrink-0" />
                    )}
                    <span>{renderInline(it.text, `${key}-${idx}`)}</span>
                </li>
            ));
            blocks.push(
                list.ordered ? (
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

const SPEAKER_RE = /^(Speaker\s+\w+|[A-Z][\w .'-]{0,40}):\s*(.*)$/;

const SPEAKER_COLORS = [
    "text-accent-cyan",
    "text-emerald-400",
    "text-amber-400",
    "text-violet-400",
    "text-rose-400",
    "text-sky-400",
];

/**
 * Render a diarized transcript as one block per speaker turn, colouring
 * each speaker label consistently in order of first appearance.
 *
 * Plaud transcripts arrive as `SPEAKER_00: ...` / `Speaker 1: ...` lines,
 * one turn per line. A line with no recognised label is appended to the
 * preceding unlabelled turn. When no line carries a label at all (a plain
 * Whisper transcript, for example) the whole text is rendered as
 * pre-wrapped plain text, which is the previous behaviour.
 */
export function SpeakerTranscript({
    text,
    className,
}: {
    text: string;
    className?: string;
}): JSX.Element {
    const lines = text
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

    const turns: { speaker: string | null; text: string }[] = [];
    for (const line of lines) {
        const m = line.match(SPEAKER_RE);
        if (m) turns.push({ speaker: m[1], text: m[2] });
        else if (turns.length && turns[turns.length - 1].speaker === null)
            turns[turns.length - 1].text += ` ${line}`;
        else turns.push({ speaker: null, text: line });
    }

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

    const order: string[] = [];
    const colorFor = (speaker: string) => {
        let idx = order.indexOf(speaker);
        if (idx === -1) {
            order.push(speaker);
            idx = order.length - 1;
        }
        return SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
    };

    return (
        <div className={`space-y-3 ${className ?? ""}`}>
            {turns.map((t, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: turns are reparsed from the transcript on every render and never reordered
                <div key={`turn-${i}`} className="leading-relaxed">
                    {t.speaker && (
                        <span
                            className={`font-semibold ${colorFor(t.speaker)} mr-2`}
                        >
                            {t.speaker}:
                        </span>
                    )}
                    <span>{t.text}</span>
                </div>
            ))}
        </div>
    );
}
