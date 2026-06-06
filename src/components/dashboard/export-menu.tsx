"use client";

import {
    Download,
    FileText,
    FileType,
    Map as MapIcon,
    Sparkles,
} from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SummaryData } from "@/hooks/use-transcription-summary";

type ExportScope = "summary" | "transcription" | "both";
type ExportFormat = "txt" | "md" | "docx" | "pdf";

interface ExportMenuProps {
    recordingTitle: string;
    transcriptionText?: string | null;
    summaryData?: SummaryData | null;
}

function formatSummaryText(
    data: SummaryData,
    format: "plain" | "markdown",
): string {
    const lines: string[] = [];
    const h2 = format === "markdown" ? "## " : "";
    const bullet = format === "markdown" ? "- " : "  • ";

    if (data.summary) {
        lines.push(`${h2}Summary`, "", data.summary, "");
    }
    if (data.keyPoints?.length) {
        lines.push(`${h2}Key Points`, "");
        for (const p of data.keyPoints) lines.push(`${bullet}${p}`);
        lines.push("");
    }
    if (data.actionItems?.length) {
        lines.push(`${h2}Action Items`, "");
        for (const a of data.actionItems) lines.push(`${bullet}${a}`);
        lines.push("");
    }
    return lines.join("\n");
}

function buildExportContent(
    scope: ExportScope,
    format: ExportFormat,
    title: string,
    transcription?: string | null,
    summary?: SummaryData | null,
): string {
    const isMarkdown = format === "md";
    const heading = isMarkdown ? `# ${title}` : title.toUpperCase();
    const sep = isMarkdown ? "\n---\n" : `\n${"─".repeat(60)}\n`;
    const parts: string[] = [heading, ""];

    if (scope === "transcription" || scope === "both") {
        parts.push(
            isMarkdown ? "## Transcription" : "TRANSCRIPTION",
            "",
            transcription || "(no transcription)",
            "",
        );
    }

    if ((scope === "summary" || scope === "both") && summary) {
        if (scope === "both") parts.push(sep);
        parts.push(
            formatSummaryText(summary, isMarkdown ? "markdown" : "plain"),
        );
    }

    return parts.join("\n");
}

function downloadText(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    downloadBlob(blob, filename);
}

function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
}

// ── Real .docx generation via the `docx` library ───────────────────
async function exportAsDocx(
    title: string,
    slug: string,
    scope: ExportScope,
    transcription: string | null | undefined,
    summary: SummaryData | null | undefined,
): Promise<void> {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import(
        "docx"
    );

    // Build child paragraphs incrementally so we can conditionally include sections
    const children: InstanceType<typeof Paragraph>[] = [
        new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: "" }),
    ];

    if (scope === "transcription" || scope === "both") {
        children.push(
            new Paragraph({
                text: "Transcription",
                heading: HeadingLevel.HEADING_2,
            }),
            new Paragraph({ text: "" }),
            new Paragraph({
                children: [new TextRun(transcription || "(no transcription)")],
            }),
            new Paragraph({ text: "" }),
        );
    }

    if ((scope === "summary" || scope === "both") && summary) {
        if (scope === "both") {
            children.push(new Paragraph({ text: "" }));
        }
        if (summary.summary) {
            children.push(
                new Paragraph({
                    text: "Summary",
                    heading: HeadingLevel.HEADING_2,
                }),
                new Paragraph({ text: "" }),
                new Paragraph({
                    children: [new TextRun(summary.summary)],
                }),
                new Paragraph({ text: "" }),
            );
        }
        if (summary.keyPoints?.length) {
            children.push(
                new Paragraph({
                    text: "Key Points",
                    heading: HeadingLevel.HEADING_2,
                }),
                new Paragraph({ text: "" }),
                ...summary.keyPoints.map(
                    (p) => new Paragraph({ text: p, bullet: { level: 0 } }),
                ),
                new Paragraph({ text: "" }),
            );
        }
        if (summary.actionItems?.length) {
            children.push(
                new Paragraph({
                    text: "Action Items",
                    heading: HeadingLevel.HEADING_2,
                }),
                new Paragraph({ text: "" }),
                ...summary.actionItems.map(
                    (a) => new Paragraph({ text: a, bullet: { level: 0 } }),
                ),
            );
        }
    }

    const doc = new Document({
        sections: [{ properties: {}, children }],
    });

    const blob = await Packer.toBlob(doc);
    downloadBlob(blob, `${slug}-${scope}.docx`);
}

// ── Real .pdf generation via jsPDF ─────────────────────────────────
async function exportAsPdf(
    title: string,
    slug: string,
    scope: ExportScope,
    transcription: string | null | undefined,
    summary: SummaryData | null | undefined,
): Promise<void> {
    const { jsPDF } = await import("jspdf");

    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const margin = 20;
    const pageW = pdf.internal.pageSize.getWidth();
    const maxW = pageW - margin * 2;
    const pageH = pdf.internal.pageSize.getHeight();
    let y = margin;

    const checkPage = (needed = 8) => {
        if (y + needed > pageH - margin) {
            pdf.addPage();
            y = margin;
        }
    };

    const h1 = (text: string) => {
        checkPage(16);
        pdf.setFontSize(22);
        pdf.setFont("helvetica", "bold");
        const lines = pdf.splitTextToSize(text, maxW) as string[];
        pdf.text(lines, margin, y);
        y += lines.length * 10 + 4;
    };

    const h2 = (text: string) => {
        y += 4;
        checkPage(12);
        pdf.setFontSize(14);
        pdf.setFont("helvetica", "bold");
        pdf.text(text, margin, y);
        y += 9;
    };

    const body = (text: string) => {
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "normal");
        const lines = pdf.splitTextToSize(text, maxW) as string[];
        for (const line of lines) {
            checkPage(7);
            pdf.text(line, margin, y);
            y += 6;
        }
        y += 3;
    };

    const bullet = (text: string) => {
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "normal");
        const lines = pdf.splitTextToSize(text, maxW - 6) as string[];
        checkPage(7);
        pdf.text("•", margin, y);
        pdf.text(lines[0] ?? "", margin + 5, y);
        y += 6;
        for (let i = 1; i < lines.length; i++) {
            checkPage(6);
            pdf.text(lines[i], margin + 5, y);
            y += 6;
        }
        y += 1;
    };

    // Content
    h1(title);

    if (scope === "transcription" || scope === "both") {
        h2("Transcription");
        body(transcription || "(no transcription)");
    }

    if ((scope === "summary" || scope === "both") && summary) {
        if (summary.summary) {
            h2("Summary");
            body(summary.summary);
        }
        if (summary.keyPoints?.length) {
            h2("Key Points");
            for (const p of summary.keyPoints) bullet(p);
            y += 2;
        }
        if (summary.actionItems?.length) {
            h2("Action Items");
            for (const a of summary.actionItems) bullet(a);
        }
    }

    pdf.save(`${slug}-${scope}.pdf`);
}

export function ExportMenu({
    recordingTitle,
    transcriptionText,
    summaryData,
}: ExportMenuProps) {
    const hasTranscription = !!transcriptionText;
    const hasSummary = !!summaryData?.summary;

    const handleExport = useCallback(
        (scope: ExportScope, format: ExportFormat) => {
            const slug = slugify(recordingTitle || "recording");
            const titleText = recordingTitle || "Recording";

            if (format === "docx") {
                toast.promise(
                    exportAsDocx(
                        titleText,
                        slug,
                        scope,
                        transcriptionText,
                        summaryData,
                    ),
                    {
                        loading: "Generating .docx…",
                        success: `Exported ${scope} as .docx`,
                        error: "Failed to generate .docx",
                    },
                );
                return;
            }

            if (format === "pdf") {
                toast.promise(
                    exportAsPdf(
                        titleText,
                        slug,
                        scope,
                        transcriptionText,
                        summaryData,
                    ),
                    {
                        loading: "Generating .pdf…",
                        success: `Exported ${scope} as .pdf`,
                        error: "Failed to generate .pdf",
                    },
                );
                return;
            }

            // txt / md — synchronous, no library needed
            const content = buildExportContent(
                scope,
                format,
                titleText,
                transcriptionText,
                summaryData,
            );
            const mime =
                format === "md"
                    ? "text/markdown;charset=utf-8"
                    : "text/plain;charset=utf-8";
            downloadText(content, `${slug}-${scope}.${format}`, mime);
            toast.success(`Exported ${scope} as .${format}`);
        },
        [recordingTitle, transcriptionText, summaryData],
    );

    if (!hasTranscription && !hasSummary) return null;

    const formats: { ext: ExportFormat; label: string }[] = [
        { ext: "txt", label: ".txt" },
        { ext: "md", label: ".md" },
        { ext: "docx", label: ".docx" },
        { ext: "pdf", label: ".pdf" },
    ];

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                    <Download className="size-3" />
                    Export
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
                {hasSummary && (
                    <>
                        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                            <Sparkles className="size-3" />
                            Summary & Mind Map
                        </DropdownMenuLabel>
                        <DropdownMenuGroup>
                            {formats.map((f) => (
                                <DropdownMenuItem
                                    key={`summary-${f.ext}`}
                                    onClick={() =>
                                        handleExport("summary", f.ext)
                                    }
                                    className="text-xs"
                                >
                                    <FileType className="size-3 mr-2" />
                                    Export as {f.label}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                    </>
                )}

                {hasTranscription && (
                    <>
                        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                            <FileText className="size-3" />
                            Transcription
                        </DropdownMenuLabel>
                        <DropdownMenuGroup>
                            {formats.map((f) => (
                                <DropdownMenuItem
                                    key={`transcription-${f.ext}`}
                                    onClick={() =>
                                        handleExport("transcription", f.ext)
                                    }
                                    className="text-xs"
                                >
                                    <FileType className="size-3 mr-2" />
                                    Export as {f.label}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuGroup>
                    </>
                )}

                {hasSummary && hasTranscription && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                            <MapIcon className="size-3" />
                            Both
                        </DropdownMenuLabel>
                        <DropdownMenuGroup>
                            {formats.map((f) => (
                                <DropdownMenuItem
                                    key={`both-${f.ext}`}
                                    onClick={() => handleExport("both", f.ext)}
                                    className="text-xs"
                                >
                                    <FileType className="size-3 mr-2" />
                                    Export as {f.label}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuGroup>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
