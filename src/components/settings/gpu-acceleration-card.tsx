"use client";

import {
    AlertTriangle,
    CheckCircle2,
    Cpu,
    Loader2,
    Sparkles,
    XCircle,
    Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";

interface GpuStatus {
    provisioningEnabled: boolean;
    dockerReachable: boolean;
    gpuAvailable: boolean;
    whisper: { exists: boolean; running: boolean; isCuda: boolean };
    whisperx: { exists: boolean; running: boolean };
    hasWhisperProvider: boolean;
}

type ProvisionEvent =
    | {
          type: "pull";
          service: string;
          image: string;
          status: string;
          currentBytes: number;
          totalBytes: number;
          percent: number;
      }
    | { type: "phase"; phase: "pull" | "starting"; service: string }
    | { type: "done"; service: string }
    | { type: "complete" }
    | { type: "error"; message: string };

interface ServiceProgress {
    label: string;
    phase: "pull" | "starting" | "done";
    percent: number;
    currentBytes: number;
    totalBytes: number;
    status: string;
}

const SERVICE_LABELS: Record<string, string> = {
    whisperx: "Speaker diarization (WhisperX)",
    whisper: "GPU transcription (CUDA Whisper)",
};

function formatBytes(bytes: number): string {
    if (!bytes) return "0 MB";
    const mb = bytes / 1_000_000;
    if (mb < 1000) return `${mb.toFixed(0)} MB`;
    return `${(mb / 1000).toFixed(1)} GB`;
}

function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "—";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

export function GpuAccelerationCard({
    isHosted = false,
}: {
    isHosted?: boolean;
}) {
    const [status, setStatus] = useState<GpuStatus | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [wantDiarization, setWantDiarization] = useState(false);
    const [wantGpuTranscription, setWantGpuTranscription] = useState(false);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<Record<string, ServiceProgress>>(
        {},
    );
    const [elapsed, setElapsed] = useState(0);
    const [finished, setFinished] = useState<null | "ok" | "error">(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const startRef = useRef(0);

    const fetchStatus = useCallback(async () => {
        try {
            const res = await fetch("/api/settings/ai/gpu/status");
            if (!res.ok) return;
            const data = (await res.json()) as GpuStatus;
            setStatus(data);
            setWantDiarization(data.whisperx.running);
            setWantGpuTranscription(data.whisper.isCuda);
        } catch {
            // leave status null -> card stays hidden
        } finally {
            setLoaded(true);
        }
    }, []);

    useEffect(() => {
        if (isHosted) {
            setLoaded(true);
            return;
        }
        fetchStatus();
    }, [isHosted, fetchStatus]);

    // Elapsed ticker while provisioning.
    useEffect(() => {
        if (!running) return;
        const id = setInterval(() => {
            setElapsed((Date.now() - startRef.current) / 1000);
        }, 250);
        return () => clearInterval(id);
    }, [running]);

    if (isHosted || !loaded || !status) return null;
    // Per the feature spec, only surface this once a whisper/whisperx provider
    // is connected.
    if (!status.hasWhisperProvider) return null;

    const diarizationActive = status.whisperx.running;
    const gpuTranscriptionActive = status.whisper.isCuda;

    // Only services that are selected AND not already active need provisioning.
    const toProvision = {
        diarization: wantDiarization && !diarizationActive,
        gpuTranscription: wantGpuTranscription && !gpuTranscriptionActive,
    };
    const canApply =
        status.provisioningEnabled &&
        status.dockerReachable &&
        (toProvision.diarization || toProvision.gpuTranscription) &&
        !running;

    const handleApply = async () => {
        setProgress({});
        setFinished(null);
        setErrorMsg(null);
        setElapsed(0);
        startRef.current = Date.now();
        setDialogOpen(true);
        setRunning(true);
        try {
            const res = await fetch("/api/settings/ai/gpu/provision", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(toProvision),
            });
            if (!res.ok || !res.body) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error ?? "Failed to start provisioning.");
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            let sawError: string | null = null;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                let idx = buf.indexOf("\n");
                while (idx >= 0) {
                    const line = buf.slice(0, idx).trim();
                    buf = buf.slice(idx + 1);
                    idx = buf.indexOf("\n");
                    if (!line) continue;
                    let evt: ProvisionEvent;
                    try {
                        evt = JSON.parse(line) as ProvisionEvent;
                    } catch {
                        continue;
                    }
                    if (evt.type === "error") sawError = evt.message;
                    applyEvent(evt, setProgress);
                }
            }
            if (sawError) {
                setFinished("error");
                setErrorMsg(sawError);
            } else {
                setFinished("ok");
                toast.success("GPU services enabled.");
                await fetchStatus();
            }
        } catch (error) {
            setFinished("error");
            setErrorMsg(
                error instanceof Error ? error.message : "Provisioning failed.",
            );
        } finally {
            setRunning(false);
        }
    };

    const overall = aggregateOverall(progress);
    const etaSeconds =
        running && overall.currentBytes > 0 && overall.totalBytes > 0
            ? ((overall.totalBytes - overall.currentBytes) /
                  overall.currentBytes) *
              elapsed
            : Number.NaN;

    return (
        <>
            <Panel className="space-y-4">
                <div className="flex items-start gap-3">
                    <div className="rounded-md bg-primary/10 p-2 text-primary">
                        <Zap className="size-4" />
                    </div>
                    <div className="flex-1">
                        <h3 className="font-semibold text-sm">
                            GPU acceleration
                        </h3>
                        <p className="text-xs text-muted-foreground">
                            Download and start GPU services for your local
                            whisper server — no shell required.
                        </p>
                    </div>
                </div>

                {!status.provisioningEnabled ? (
                    <Panel
                        variant="inset"
                        className="space-y-1 text-xs text-muted-foreground"
                    >
                        <p>
                            In-UI GPU management is off. To enable it, bring the
                            app up with the provisioning override (mounts the
                            Docker socket — grants host-level access):
                        </p>
                        <code className="block font-mono text-[11px] text-foreground break-all">
                            docker compose -f docker-compose.yml -f
                            docker-compose.provisioning.yml up -d
                        </code>
                    </Panel>
                ) : !status.dockerReachable ? (
                    <Panel
                        variant="inset"
                        className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400"
                    >
                        <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                        <span>
                            Docker socket is enabled but not reachable. Confirm
                            the provisioning override is applied and the app was
                            restarted.
                        </span>
                    </Panel>
                ) : (
                    <>
                        {!status.gpuAvailable && (
                            <Panel
                                variant="inset"
                                className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400"
                            >
                                <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                                <span>
                                    No NVIDIA GPU runtime detected on this host.
                                    You can still download the images, but the
                                    GPU container won&apos;t run until a GPU +
                                    NVIDIA Container Toolkit is available.
                                </span>
                            </Panel>
                        )}

                        <div className="space-y-2">
                            <ToggleRow
                                icon={<Sparkles className="size-4" />}
                                label={SERVICE_LABELS.whisperx}
                                description="Speaker labels on transcripts (needs a Hugging Face token to fully activate)."
                                active={diarizationActive}
                                checked={wantDiarization}
                                onChange={setWantDiarization}
                            />
                            <ToggleRow
                                icon={<Cpu className="size-4" />}
                                label={SERVICE_LABELS.whisper}
                                description="Swap the CPU whisper image for the CUDA build. Recreates the container (brief downtime)."
                                active={gpuTranscriptionActive}
                                checked={wantGpuTranscription}
                                onChange={setWantGpuTranscription}
                            />
                        </div>

                        <div className="flex justify-end">
                            <MetalButton
                                variant="cyan"
                                onClick={handleApply}
                                disabled={!canApply}
                            >
                                {running ? "Working…" : "Download & enable"}
                            </MetalButton>
                        </div>
                    </>
                )}
            </Panel>

            <Dialog
                open={dialogOpen}
                onOpenChange={(open) => {
                    // Don't allow closing mid-run.
                    if (running) return;
                    setDialogOpen(open);
                }}
            >
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Enabling GPU acceleration</DialogTitle>
                        <DialogDescription>
                            {finished === "ok"
                                ? "Done."
                                : finished === "error"
                                  ? "Something went wrong."
                                  : "Downloading and starting containers…"}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        {Object.entries(progress).map(([service, p]) => (
                            <div key={service} className="space-y-1.5">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="font-medium">
                                        {p.label}
                                    </span>
                                    {p.phase === "done" ? (
                                        <CheckCircle2 className="size-4 text-emerald-500" />
                                    ) : p.phase === "starting" ? (
                                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                                    ) : (
                                        <span className="text-xs text-muted-foreground">
                                            {p.percent}%
                                        </span>
                                    )}
                                </div>
                                <Progress
                                    value={p.phase === "done" ? 100 : p.percent}
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    {p.phase === "starting"
                                        ? "Starting container…"
                                        : p.phase === "done"
                                          ? "Ready"
                                          : `${p.status} · ${formatBytes(
                                                p.currentBytes,
                                            )} / ${formatBytes(p.totalBytes)}`}
                                </p>
                            </div>
                        ))}

                        <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t pt-2">
                            <span>Elapsed {formatDuration(elapsed)}</span>
                            {running && (
                                <span>ETA {formatDuration(etaSeconds)}</span>
                            )}
                        </div>

                        {finished === "error" && errorMsg && (
                            <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300">
                                <XCircle className="size-3.5 shrink-0 mt-0.5" />
                                <span>{errorMsg}</span>
                            </div>
                        )}

                        {!running && (
                            <div className="flex justify-end">
                                <MetalButton
                                    onClick={() => setDialogOpen(false)}
                                >
                                    Close
                                </MetalButton>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}

function ToggleRow({
    icon,
    label,
    description,
    active,
    checked,
    onChange,
}: {
    icon: React.ReactNode;
    label: string;
    description: string;
    active: boolean;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <Panel
            variant="inset"
            className="flex items-center justify-between gap-3"
        >
            <div className="flex items-start gap-2.5 min-w-0">
                <div className="text-muted-foreground mt-0.5">{icon}</div>
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{label}</span>
                        {active && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                Active
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {description}
                    </p>
                </div>
            </div>
            <Switch
                checked={checked}
                onCheckedChange={onChange}
                disabled={active}
            />
        </Panel>
    );
}

function applyEvent(
    evt: ProvisionEvent,
    setProgress: React.Dispatch<
        React.SetStateAction<Record<string, ServiceProgress>>
    >,
) {
    if (evt.type === "phase") {
        setProgress((prev) => ({
            ...prev,
            [evt.service]: {
                label: SERVICE_LABELS[evt.service] ?? evt.service,
                phase: evt.phase,
                percent: prev[evt.service]?.percent ?? 0,
                currentBytes: prev[evt.service]?.currentBytes ?? 0,
                totalBytes: prev[evt.service]?.totalBytes ?? 0,
                status: evt.phase === "starting" ? "Starting" : "Pulling",
            },
        }));
    } else if (evt.type === "pull") {
        setProgress((prev) => ({
            ...prev,
            [evt.service]: {
                label: SERVICE_LABELS[evt.service] ?? evt.service,
                phase: "pull",
                percent: evt.percent,
                currentBytes: evt.currentBytes,
                totalBytes: evt.totalBytes,
                status: evt.status,
            },
        }));
    } else if (evt.type === "done") {
        setProgress((prev) => ({
            ...prev,
            [evt.service]: {
                label: SERVICE_LABELS[evt.service] ?? evt.service,
                phase: "done",
                percent: 100,
                currentBytes: prev[evt.service]?.currentBytes ?? 0,
                totalBytes: prev[evt.service]?.totalBytes ?? 0,
                status: "Ready",
            },
        }));
    }
}

function aggregateOverall(progress: Record<string, ServiceProgress>): {
    currentBytes: number;
    totalBytes: number;
} {
    let currentBytes = 0;
    let totalBytes = 0;
    for (const p of Object.values(progress)) {
        currentBytes += p.currentBytes;
        totalBytes += p.totalBytes;
    }
    return { currentBytes, totalBytes };
}
