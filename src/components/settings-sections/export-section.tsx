"use client";

import { Download, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsGroup } from "@/components/settings/section-header";
import { SettingsSelectTrigger } from "@/components/settings/settings-select";
import {
    SettingsRow,
    SettingsRows,
    ToggleRow,
} from "@/components/settings/toggle-row";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectValue,
} from "@/components/ui/select";
import { StatusDot } from "@/components/ui/status-dot";
import { useSettings } from "@/hooks/use-settings";
import { toast } from "@/lib/toast";

const exportFormatOptions = [
    { label: "JSON", value: "json", description: "Structured data format" },
    { label: "TXT", value: "txt", description: "Plain text format" },
    { label: "SRT", value: "srt", description: "Subtitle format" },
    { label: "VTT", value: "vtt", description: "WebVTT subtitle format" },
];

const backupFrequencyOptions = [
    { label: "Never", value: "never" },
    { label: "Daily", value: "daily" },
    { label: "Weekly", value: "weekly" },
    { label: "Monthly", value: "monthly" },
];

interface ExportJobStatus {
    id: string;
    // "expired" is a client-facing derived status: the server reports it
    // instead of "completed" once `expiresAt` has passed, even if the
    // row hasn't been swept from the DB yet (the cleanup worker keeps it
    // until the storage delete actually succeeds).
    status: "pending" | "processing" | "completed" | "failed" | "expired";
    createdAt: string;
    completedAt: string | null;
    expiresAt: string | null;
    recordingCount: number | null;
    fileSize: number | null;
    errorMessage: string | null;
}

const ACTIVE_STATUSES = new Set(["pending", "processing"]);
const POLL_INTERVAL_MS = 4000;

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
}

interface ExportSectionProps {
    onReRunOnboarding?: () => void;
}

export function ExportSection({ onReRunOnboarding }: ExportSectionProps) {
    const { isLoadingSettings, isSavingSettings, setIsLoadingSettings } =
        useSettings();
    const [defaultExportFormat, setDefaultExportFormat] = useState("json");
    const [autoExport, setAutoExport] = useState(false);
    const [backupFrequency, setBackupFrequency] = useState<string | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [isStartingBackup, setIsStartingBackup] = useState(false);
    const [backupJob, setBackupJob] = useState<ExportJobStatus | null>(null);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch("/api/settings/user");
                if (response.ok) {
                    const data = await response.json();
                    setDefaultExportFormat(data.defaultExportFormat ?? "json");
                    setAutoExport(data.autoExport ?? false);
                    setBackupFrequency(data.backupFrequency ?? null);
                }
            } catch (error) {
                console.error("Failed to fetch settings:", error);
            } finally {
                setIsLoadingSettings(false);
            }
        };
        fetchSettings();
    }, [setIsLoadingSettings]);

    // Pick up the most recent job on load -- covers reopening Settings
    // after starting a backup elsewhere, or arriving from the
    // "export ready" email.
    useEffect(() => {
        const fetchJobs = async () => {
            try {
                const response = await fetch("/api/backup");
                if (!response.ok) return;
                const data = await response.json();
                if (data.jobs?.[0]) setBackupJob(data.jobs[0]);
            } catch {
                // Non-fatal -- the user can still start a fresh backup.
            }
        };
        fetchJobs();
    }, []);

    // Poll while a job is active. Stops itself once the job leaves
    // pending/processing, so there's no polling overhead once idle.
    // Single-flight by construction: the next poll is only scheduled
    // from the previous one's `finally`, so a slow response (>4s)
    // can't cause overlapping in-flight requests and duplicate
    // terminal-state handling (extra toasts).
    useEffect(() => {
        if (!backupJob || !ACTIVE_STATUSES.has(backupJob.status)) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;

        const poll = async () => {
            try {
                const response = await fetch(`/api/backup/${backupJob.id}`);
                if (!cancelled && response.ok) {
                    const data = await response.json();
                    if (!cancelled) {
                        setBackupJob(data.job);
                        if (data.job.status === "completed") {
                            toast.success("Backup ready to download");
                        } else if (data.job.status === "failed") {
                            toast.error("Backup failed to build");
                        }
                    }
                }
            } catch {
                // Transient -- the next tick will retry.
            } finally {
                if (!cancelled) {
                    timer = setTimeout(poll, POLL_INTERVAL_MS);
                }
            }
        };
        timer = setTimeout(poll, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [backupJob]);

    const handleExportBackupSettingChange = async (updates: {
        defaultExportFormat?: string;
        autoExport?: boolean;
        backupFrequency?: string | null;
    }) => {
        const previousValues: Record<string, unknown> = {};
        if (updates.defaultExportFormat !== undefined) {
            previousValues.defaultExportFormat = defaultExportFormat;
            setDefaultExportFormat(updates.defaultExportFormat);
        }
        if (updates.autoExport !== undefined) {
            previousValues.autoExport = autoExport;
            setAutoExport(updates.autoExport);
        }
        if (updates.backupFrequency !== undefined) {
            previousValues.backupFrequency = backupFrequency;
            setBackupFrequency(updates.backupFrequency);
        }

        try {
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });

            if (!response.ok) {
                throw new Error("Failed to save settings");
            }
        } catch {
            if (updates.defaultExportFormat !== undefined) {
                const prev = previousValues.defaultExportFormat;
                if (typeof prev === "string") setDefaultExportFormat(prev);
            }
            if (updates.autoExport !== undefined) {
                const prev = previousValues.autoExport;
                if (typeof prev === "boolean") setAutoExport(prev);
            }
            if (updates.backupFrequency !== undefined) {
                const prev = previousValues.backupFrequency;
                if (typeof prev === "string" || prev === null)
                    setBackupFrequency(prev);
            }
            toast.error("Failed to save settings. Changes reverted.");
        }
    };

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const response = await fetch(
                `/api/export?format=${defaultExportFormat}`,
            );
            if (!response.ok) throw new Error("Export failed");

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download =
                response.headers
                    .get("Content-Disposition")
                    ?.split("filename=")[1]
                    ?.replace(/"/g, "") || `export.${defaultExportFormat}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            toast.success("Export completed");
        } catch {
            toast.error("Failed to export recordings");
        } finally {
            setIsExporting(false);
        }
    };

    const handleStartBackup = async () => {
        setIsStartingBackup(true);
        try {
            const response = await fetch("/api/backup", { method: "POST" });
            if (!response.ok) throw new Error("Backup request failed");
            const data = await response.json();
            setBackupJob(data.job);
            toast.success(
                ACTIVE_STATUSES.has(data.job.status)
                    ? "Backup started -- this can take a few minutes for large libraries"
                    : "Backup ready to download",
            );
        } catch {
            toast.error("Failed to start backup");
        } finally {
            setIsStartingBackup(false);
        }
    };

    const backupBusy =
        isStartingBackup ||
        (backupJob !== null && ACTIVE_STATUSES.has(backupJob.status));

    return (
        <div className="flex flex-col gap-11">
            <SettingsGroup
                title="Download"
                description="Transcripts and summaries right away, or everything including the original audio"
            >
                <SettingsRows>
                    <SettingsRow
                        label="Format for text exports"
                        description="Used by Export text"
                        controlId="export-format"
                        control={
                            <Select
                                value={defaultExportFormat}
                                onValueChange={(value) => {
                                    setDefaultExportFormat(value);
                                    handleExportBackupSettingChange({
                                        defaultExportFormat: value,
                                    });
                                }}
                                disabled={isSavingSettings || isLoadingSettings}
                            >
                                <SettingsSelectTrigger id="export-format">
                                    <SelectValue>
                                        {exportFormatOptions.find(
                                            (opt) =>
                                                opt.value ===
                                                defaultExportFormat,
                                        )?.label || "JSON"}
                                    </SelectValue>
                                </SettingsSelectTrigger>
                                <SelectContent align="end">
                                    {exportFormatOptions.map((option) => (
                                        <SelectItem
                                            key={option.value}
                                            value={option.value}
                                        >
                                            <div>
                                                <div>{option.label}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {option.description}
                                                </div>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        }
                    />
                    <SettingsRow
                        label="Export text"
                        description="Downloads every transcript and summary now"
                        control={
                            <Button
                                onClick={handleExport}
                                disabled={isExporting}
                                variant="quiet"
                                size="compact"
                            >
                                {isExporting ? (
                                    <Loader2 className="animate-spin" />
                                ) : (
                                    <Download />
                                )}
                                {isExporting ? "Exporting…" : "Export text"}
                            </Button>
                        }
                    />
                    <SettingsRow
                        label="Full backup"
                        description="A zip with your audio, transcripts and summaries. Large libraries take a few minutes to build in the background, and you'll get an email when it's ready. A backup stays available for 7 days; a newer backup with all your audio replaces the previous one"
                        control={
                            <Button
                                onClick={handleStartBackup}
                                disabled={backupBusy}
                                variant="ink"
                                size="compact"
                            >
                                {backupBusy ? (
                                    <Loader2 className="animate-spin" />
                                ) : (
                                    <Download />
                                )}
                                {backupBusy
                                    ? "Building archive…"
                                    : "Create full backup"}
                            </Button>
                        }
                    >
                        {backupJob && (
                            <div className="squircle flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-item)] bg-background px-4 py-3 text-ui">
                                {backupJob.status === "completed" && (
                                    <>
                                        <span className="flex items-center gap-2 text-strong">
                                            <StatusDot tone="ready" />
                                            Backup ready
                                            {backupJob.recordingCount !==
                                                null &&
                                                `, ${backupJob.recordingCount} recording${backupJob.recordingCount === 1 ? "" : "s"}`}
                                            {backupJob.fileSize !== null &&
                                                ` (${formatBytes(backupJob.fileSize)})`}
                                        </span>
                                        <Button
                                            asChild
                                            variant="quiet"
                                            size="compact"
                                        >
                                            <a
                                                href={`/api/backup/${backupJob.id}/download`}
                                            >
                                                <Download />
                                                Download
                                            </a>
                                        </Button>
                                    </>
                                )}
                                {ACTIVE_STATUSES.has(backupJob.status) && (
                                    <span className="flex items-center gap-2 text-subtle">
                                        <StatusDot tone="working" />
                                        Building your archive
                                        {backupJob.status === "pending"
                                            ? " (queued)"
                                            : ""}
                                        …
                                    </span>
                                )}
                                {backupJob.status === "failed" && (
                                    <span className="flex items-center gap-2 text-strong">
                                        <StatusDot tone="attention" />
                                        Backup failed to build. Try again, or
                                        contact support if it keeps failing.
                                    </span>
                                )}
                                {backupJob.status === "expired" && (
                                    <span className="flex items-center gap-2 text-subtle">
                                        <StatusDot tone="idle" />
                                        That backup has expired. Create a new
                                        one to download it again.
                                    </span>
                                )}
                            </div>
                        )}
                    </SettingsRow>
                </SettingsRows>
            </SettingsGroup>

            <SettingsGroup title="Automatic" description="Not available yet">
                <SettingsRows>
                    <ToggleRow
                        id="auto-export"
                        label="Export new recordings automatically"
                        description="When they sync from your recorder"
                        checked={autoExport}
                        onCheckedChange={(checked) => {
                            setAutoExport(checked);
                            handleExportBackupSettingChange({
                                autoExport: checked,
                            });
                        }}
                        disabled={true}
                    />
                    <SettingsRow
                        label="Back up on a schedule"
                        description="How often to create a backup"
                        controlId="backup-frequency"
                        disabled
                        control={
                            <Select
                                value={backupFrequency || "never"}
                                onValueChange={(value) => {
                                    const frequency =
                                        value === "never" ? null : value;
                                    setBackupFrequency(frequency);
                                    handleExportBackupSettingChange({
                                        backupFrequency: frequency,
                                    });
                                }}
                                disabled={true}
                            >
                                <SettingsSelectTrigger id="backup-frequency">
                                    <SelectValue>
                                        {backupFrequencyOptions.find(
                                            (opt) =>
                                                opt.value ===
                                                (backupFrequency || "never"),
                                        )?.label || "Never"}
                                    </SelectValue>
                                </SettingsSelectTrigger>
                                <SelectContent align="end">
                                    {backupFrequencyOptions.map((option) => (
                                        <SelectItem
                                            key={option.value}
                                            value={option.value}
                                        >
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        }
                    />
                </SettingsRows>
            </SettingsGroup>

            <SettingsGroup title="Onboarding">
                <SettingsRows>
                    <SettingsRow
                        label="Run onboarding again"
                        description="Walks you through connecting a recorder and a provider"
                        control={
                            <Button
                                onClick={async () => {
                                    try {
                                        await fetch("/api/settings/user", {
                                            method: "PUT",
                                            headers: {
                                                "Content-Type":
                                                    "application/json",
                                            },
                                            body: JSON.stringify({
                                                onboardingCompleted: false,
                                            }),
                                        });
                                        onReRunOnboarding?.();
                                    } catch {
                                        toast.error(
                                            "Failed to reset onboarding",
                                        );
                                    }
                                }}
                                variant="quiet"
                                size="compact"
                            >
                                <RefreshCw />
                                Re-run onboarding
                            </Button>
                        }
                    />
                </SettingsRows>
            </SettingsGroup>
        </div>
    );
}
