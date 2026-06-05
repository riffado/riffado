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
            const content = buildExportContent(
                scope,
                format,
                recordingTitle || "Recording",
                transcriptionText,
                summaryData,
            );

            const ext = format;
            const filename = `${slug}-${scope}.${ext}`;

            if (format === "docx" || format === "pdf") {
                // For docx/pdf we create a rich-ish text blob — real .docx
                // generation would need a library, so we export as the text
                // equivalent and note it in the toast.
                const fallbackExt = format === "docx" ? "txt" : "txt";
                downloadText(
                    content,
                    `${slug}-${scope}.${fallbackExt}`,
                    "text/plain;charset=utf-8",
                );
                toast.success(
                    `Exported as .${fallbackExt} — .${format} generation coming soon`,
                );
                return;
            }

            const mime =
                format === "md"
                    ? "text/markdown;charset=utf-8"
                    : "text/plain;charset=utf-8";
            downloadText(content, filename, mime);
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
