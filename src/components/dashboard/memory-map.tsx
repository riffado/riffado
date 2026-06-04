"use client";

import { X } from "lucide-react";
import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface MapNode {
    id: string;
    label: string;
    fullText: string;
    children?: MapNode[];
}

interface MemoryMapProps {
    title: string;
    summary: string;
    keyPoints?: string[] | null;
    actionItems?: string[] | null;
}

interface LayoutNode {
    id: string;
    label: string;
    fullText: string;
    x: number;
    y: number;
    width: number;
    children: LayoutNode[];
    depth: number;
    branchIdx: number;
}

const NODE_H = 28;
const LEAF_GAP = 20;
const BRANCH_GAP = 36;
const EDGE_GAP = 36;
const PAD = 28;
const MAX_LABEL = 48;
const MAX_LABEL_ROOT = 40;
const CHAR_W = 6.8;
const NODE_PX = 20;
const MAX_W = 340;
const BRANCH_MIN_W = 86;

function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    const cut = s.lastIndexOf(" ", max - 1);
    return (cut > max * 0.4 ? s.slice(0, cut) : s.slice(0, max - 1)).trimEnd() + "…";
}

function extractRootLabel(summary: string): string {
    const stripped = summary.replace(/^#+\s*/, "").replace(/^\*\*(.+?)\*\*/, "$1");
    const m = stripped.match(/^(.+?)[.!?:]\s/);
    return truncate(m ? m[1] : stripped, MAX_LABEL_ROOT);
}

function splitSentences(text: string, max: number): string[] {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    return sentences.slice(0, max).map((s) => s.trim()).filter(Boolean);
}

function clean(s: string): string {
    return s.replace(/^[-•*]\s*/, "").replace(/^\d+[.)]\s*/, "");
}

function measure(label: string, depth: number): number {
    const w = label.length * CHAR_W + NODE_PX;
    if (depth === 1) return Math.max(w, BRANCH_MIN_W);
    return Math.min(w, MAX_W);
}

function buildTree(props: MemoryMapProps): MapNode {
    const branches: MapNode[] = [];
    const parts = splitSentences(props.summary, 3);
    if (parts.length > 0) {
        branches.push({
            id: "overview", label: "Overview", fullText: "Overview",
            children: parts.map((s, i) => ({ id: `s-${i}`, label: truncate(s, MAX_LABEL), fullText: s })),
        });
    }
    if (props.keyPoints?.length) {
        branches.push({
            id: "key-points", label: "Key Points", fullText: "Key Points",
            children: props.keyPoints.map((p, i) => {
                const c = clean(p);
                return { id: `k-${i}`, label: truncate(c, MAX_LABEL), fullText: c };
            }),
        });
    }
    if (props.actionItems?.length) {
        branches.push({
            id: "actions", label: "Action Items", fullText: "Action Items",
            children: props.actionItems.map((a, i) => {
                const c = clean(a);
                return { id: `a-${i}`, label: truncate(c, MAX_LABEL), fullText: c };
            }),
        });
    }
    return { id: "root", label: extractRootLabel(props.summary), fullText: props.summary, children: branches };
}

function computeLayout(tree: MapNode): { root: LayoutNode; h: number; w: number } {
    const rootW = measure(tree.label, 0);
    let y = PAD;
    const branches: LayoutNode[] = [];

    for (let bi = 0; bi < (tree.children?.length ?? 0); bi++) {
        const branch = tree.children![bi];
        if (bi > 0) y += BRANCH_GAP;
        const bw = measure(branch.label, 1);
        const bx = PAD + rootW + EDGE_GAP;
        const leaves: LayoutNode[] = [];

        if (branch.children?.length) {
            const lx = bx + bw + EDGE_GAP;
            for (let li = 0; li < branch.children.length; li++) {
                const leaf = branch.children[li];
                const lw = measure(leaf.label, 2);
                leaves.push({ id: leaf.id, label: leaf.label, fullText: leaf.fullText, x: lx, y, width: lw, children: [], depth: 2, branchIdx: bi });
                y += NODE_H + LEAF_GAP;
            }
            y -= LEAF_GAP;
            const by = (leaves[0].y + leaves[leaves.length - 1].y) / 2;
            branches.push({ id: branch.id, label: branch.label, fullText: branch.fullText, x: bx, y: by, width: bw, children: leaves, depth: 1, branchIdx: bi });
        } else {
            branches.push({ id: branch.id, label: branch.label, fullText: branch.fullText, x: bx, y, width: bw, children: [], depth: 1, branchIdx: bi });
            y += NODE_H;
        }
    }

    const ry = branches.length > 0
        ? (branches[0].y + branches[branches.length - 1].y) / 2
        : PAD;

    const root: LayoutNode = { id: tree.id, label: tree.label, fullText: tree.fullText, x: PAD, y: ry, width: rootW, children: branches, depth: 0, branchIdx: 0 };

    let maxX = PAD + rootW;
    function walk(n: LayoutNode) { maxX = Math.max(maxX, n.x + n.width); n.children.forEach(walk); }
    walk(root);

    return { root, h: y + PAD, w: maxX + PAD };
}

const COLORS = [
    { l: "oklch(0.75 0.18 195)", g: "oklch(0.75 0.18 195 / 0.25)" },
    { l: "oklch(0.72 0.15 155)", g: "oklch(0.72 0.15 155 / 0.25)" },
    { l: "oklch(0.70 0.16 275)", g: "oklch(0.70 0.16 275 / 0.25)" },
    { l: "oklch(0.74 0.14 65)",  g: "oklch(0.74 0.14 65 / 0.25)"  },
    { l: "oklch(0.68 0.17 335)", g: "oklch(0.68 0.17 335 / 0.25)" },
];
function col(i: number) { return COLORS[i % COLORS.length]; }

function bez(x1: number, y1: number, x2: number, y2: number) {
    const dx = x2 - x1;
    return `M${x1},${y1} C${x1 + dx * 0.5},${y1} ${x2 - dx * 0.5},${y2} ${x2},${y2}`;
}

function ancestry(root: LayoutNode) {
    const p = new Map<string, string>();
    function walk(n: LayoutNode) { n.children.forEach((c) => { p.set(c.id, n.id); walk(c); }); }
    walk(root);
    return p;
}

function ancestors(id: string, p: Map<string, string>) {
    const s = new Set<string>();
    let c = id;
    while (c) { s.add(c); const pp = p.get(c); if (!pp) break; c = pp; }
    return s;
}

function descendants(n: LayoutNode): Set<string> {
    const s = new Set<string>([n.id]);
    n.children.forEach((c) => { for (const id of descendants(c)) s.add(id); });
    return s;
}

function find(root: LayoutNode, id: string): LayoutNode | null {
    if (root.id === id) return root;
    for (const c of root.children) { const f = find(c, id); if (f) return f; }
    return null;
}

interface Edge { k: string; d: string; c: string; g: string; dx: number; dy: number; pid: string; cid: string }

function edges(n: LayoutNode): Edge[] {
    const out: Edge[] = [];
    const sx = n.x + n.width, sy = n.y + NODE_H / 2;
    n.children.forEach((ch, i) => {
        const ci = n.depth === 0 ? i : n.branchIdx;
        const { l, g } = col(ci);
        const ex = ch.x, ey = ch.y + NODE_H / 2;
        out.push({ k: `e-${n.id}-${ch.id}`, d: bez(sx, sy, ex, ey), c: l, g, dx: ex, dy: ey, pid: n.id, cid: ch.id });
        out.push(...edges(ch));
    });
    return out;
}

function Edges({ data, active }: { data: Edge[]; active: Set<string> | null }) {
    return <>
        {data.map((e) => {
            const on = active ? active.has(e.pid) && active.has(e.cid) : false;
            const dim = active != null && !on;
            return <React.Fragment key={e.k}>
                {on && <path d={e.d} fill="none" stroke={e.g} strokeWidth={8} className="mm-glow" />}
                <path d={e.d} fill="none" stroke={e.c} strokeWidth={on ? 2 : 1.5} strokeOpacity={dim ? 0.12 : on ? 0.85 : 0.35} className="mm-e" />
                <circle cx={e.dx} cy={e.dy} r={on ? 4 : 3} fill={e.c} fillOpacity={dim ? 0.15 : on ? 1 : 0.5} className="mm-e" />
            </React.Fragment>;
        })}
    </>;
}

function Label({ node, on, dim, onIn, onOut, onTap }: {
    node: LayoutNode; on: boolean; dim: boolean;
    onIn: (id: string) => void; onOut: () => void; onTap: (id: string) => void;
}) {
    const isRoot = node.depth === 0;
    const isBranch = node.depth === 1 && node.children.length > 0;
    const isLeaf = node.children.length === 0;
    const c = col(node.branchIdx);

    return <div
        className="mm-n absolute select-none flex items-center"
        style={{
            left: node.x, top: node.y, height: NODE_H,
            opacity: dim ? 0.25 : 1,
            transform: on && !isRoot ? "scale(1.06)" : "scale(1)",
            transformOrigin: "left center",
            zIndex: on ? 10 : 1,
            cursor: isLeaf ? "pointer" : "default",
        }}
        onMouseEnter={() => onIn(node.id)}
        onMouseLeave={onOut}
        onClick={() => isLeaf && onTap(node.id)}
    >
        <span className={
            isRoot ? "mm-l inline-flex items-center h-7 rounded-md bg-primary/15 px-2.5 text-[13px] font-semibold text-primary leading-none whitespace-nowrap"
            : isBranch ? "mm-l inline-flex items-center h-7 rounded-md bg-muted/50 px-2 text-xs font-semibold text-foreground/80 leading-none whitespace-nowrap"
            : "mm-l inline-flex items-center h-7 text-xs text-muted-foreground leading-snug whitespace-nowrap"
        } style={on && isLeaf ? { color: c.l, textShadow: `0 0 14px ${c.g}` } : undefined}>
            {node.label}
        </span>
    </div>;
}

function MapCanvas({ root, h, w, edges: edgeData, onExpandNode }: {
    root: LayoutNode; h: number; w: number; edges: Edge[];
    onExpandNode: (id: string) => void;
}) {
    const [hovered, setHovered] = useState<string | null>(null);
    const pMap = useMemo(() => ancestry(root), [root]);

    const active = useMemo(() => {
        if (!hovered) return null;
        const n = find(root, hovered);
        if (!n) return null;
        return new Set([...ancestors(hovered, pMap), ...descendants(n)]);
    }, [hovered, root, pMap]);

    const onIn = useCallback((id: string) => setHovered(id), []);
    const onOut = useCallback(() => setHovered(null), []);

    function labels(n: LayoutNode): React.JSX.Element[] {
        const out: React.JSX.Element[] = [];
        out.push(<Label key={n.id} node={n} on={active?.has(n.id) ?? false} dim={active != null && !active.has(n.id)} onIn={onIn} onOut={onOut} onTap={onExpandNode} />);
        n.children.forEach((c) => out.push(...labels(c)));
        return out;
    }

    return <div className="relative" style={{ width: w, height: h, minWidth: 480 }}>
        <svg className="absolute inset-0" width={w} height={h} style={{ pointerEvents: "none" }}>
            <Edges data={edgeData} active={active} />
        </svg>
        {labels(root)}
    </div>;
}

function FullMapModal({ root, h, w, edgeData, expandedNode, onCloseNode, onExpandNode, onClose }: {
    root: LayoutNode; h: number; w: number; edgeData: Edge[];
    expandedNode: LayoutNode | null; onCloseNode: () => void;
    onExpandNode: (id: string) => void; onClose: () => void;
}) {
    const [visible, setVisible] = useState(false);

    useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);
    const dismiss = useCallback(() => {
        if (expandedNode) onCloseNode();
        else onClose();
    }, [expandedNode, onCloseNode, onClose]);

    useEffect(() => {
        const fn = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
        window.addEventListener("keydown", fn);
        return () => window.removeEventListener("keydown", fn);
    }, [dismiss]);

    const c = expandedNode ? col(expandedNode.branchIdx) : null;

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ opacity: visible ? 1 : 0, transition: "opacity 300ms ease" }}
        >
            <div className="absolute inset-0 bg-background/80 backdrop-blur-md" onClick={dismiss} />
            <div
                className="relative w-[90vw] max-w-5xl max-h-[85vh] rounded-2xl border border-border/60 bg-card shadow-2xl overflow-hidden flex flex-col"
                style={{
                    transform: visible ? "scale(1) translateY(0)" : "scale(0.92) translateY(20px)",
                    transition: "transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}
            >
                <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 font-mono">Memory Map</h3>
                    <button type="button" onClick={dismiss} className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                        <X className="size-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-4">
                    {expandedNode ? (
                        <div className="mm-pop flex items-center justify-center min-h-[200px]">
                            <div className="max-w-lg w-full rounded-xl border border-border/60 bg-muted/20 p-5" style={{ borderColor: c?.l }}>
                                <div className="h-[2px] -mt-5 -mx-5 mb-4 rounded-t-xl" style={{ background: `linear-gradient(90deg, transparent, ${c?.l}, transparent)` }} />
                                <p className="text-sm text-foreground/90 leading-relaxed">{expandedNode.fullText}</p>
                                <button type="button" onClick={onCloseNode} className="mt-3 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                                    Back to map
                                </button>
                            </div>
                        </div>
                    ) : (
                        <MapCanvas root={root} h={h} w={w} edges={edgeData} onExpandNode={onExpandNode} />
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}

const CSS = `
.mm-n { transition: opacity 220ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1); }
.mm-l { transition: color 220ms ease, text-shadow 280ms ease; }
.mm-e { transition: stroke-opacity 220ms ease, fill-opacity 220ms ease, stroke-width 220ms ease; }
.mm-glow { animation: mm-p 2s ease-in-out infinite; }
@keyframes mm-p { 0%,100%{stroke-opacity:.12} 50%{stroke-opacity:.35} }
.mm-pop { animation: mm-si 300ms cubic-bezier(0.34,1.56,0.64,1) forwards; }
@keyframes mm-si { from{opacity:0;transform:scale(.93)} to{opacity:1;transform:scale(1)} }
`;

function Css() {
    const done = useRef(false);
    if (!done.current && typeof document !== "undefined") {
        done.current = true;
        if (!document.getElementById("mm-css")) {
            const s = document.createElement("style"); s.id = "mm-css"; s.textContent = CSS; document.head.appendChild(s);
        }
    }
    return null;
}

export function MemoryMap({ title, summary, keyPoints, actionItems }: MemoryMapProps) {
    const tree = useMemo(() => buildTree({ title, summary, keyPoints, actionItems }), [title, summary, keyPoints, actionItems]);
    const { root, h, w } = useMemo(() => computeLayout(tree), [tree]);
    const edgeData = useMemo(() => edges(root), [root]);

    const [showModal, setShowModal] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const expandedNode = expandedId ? find(root, expandedId) : null;

    const previewH = Math.min(h, 240);

    return <div className="space-y-2">
        <Css />
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 font-mono">Memory Map</h4>

        <div className="relative overflow-hidden rounded-lg border border-border/50 bg-muted/20 dark:bg-muted/10" style={{ height: previewH }}>
            <div className="overflow-x-auto overflow-y-hidden" style={{ height: previewH }}>
                <MapCanvas root={root} h={h} w={w} edges={edgeData} onExpandNode={(id) => { setExpandedId(id); setShowModal(true); }} />
            </div>

            <div className="absolute inset-x-0 bottom-0 flex items-end justify-center bg-gradient-to-t from-background/90 via-background/50 to-transparent pb-3 pt-12">
                <button
                    type="button"
                    onClick={() => setShowModal(true)}
                    className="rounded-full border border-border/60 bg-card px-4 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all shadow-sm"
                >
                    Show full map
                </button>
            </div>
        </div>

        {showModal && (
            <FullMapModal
                root={root} h={h} w={w} edgeData={edgeData}
                expandedNode={expandedNode}
                onCloseNode={() => setExpandedId(null)}
                onExpandNode={setExpandedId}
                onClose={() => { setShowModal(false); setExpandedId(null); }}
            />
        )}
    </div>;
}
