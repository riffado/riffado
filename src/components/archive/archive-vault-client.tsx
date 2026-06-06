"use client";

import {
    Archive,
    ArchiveRestore,
    ArrowLeft,
    Clock,
    Folder,
    HardDrive,
    Loader2,
    Lock,
    LockOpen,
    Pause,
    Play,
    Search,
    Trash2,
    Volume2,
    VolumeX,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Recording {
    id: string;
    filename: string;
    duration: number;
    startTime: string;
    filesize: number;
    deviceSn: string;
    archivedAt: string | null;
    categoryIds: string[];
    hasTranscript: boolean;
    hasSummary: boolean;
}

interface Category {
    id: string;
    name: string;
    color: string;
    icon: string | null;
}

interface ArchiveVaultClientProps {
    hasPinLock: boolean;
}

const colorMap: Record<string, string> = {
    red: "bg-red-500/10 text-red-500 border-red-500/20 dark:bg-red-500/20",
    blue: "bg-blue-500/10 text-blue-500 border-blue-500/20 dark:bg-blue-500/20",
    green: "bg-green-500/10 text-green-500 border-green-500/20 dark:bg-green-500/20",
    yellow: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20 dark:bg-yellow-500/20",
    purple: "bg-purple-500/10 text-purple-500 border-purple-500/20 dark:bg-purple-500/20",
    pink: "bg-pink-500/10 text-pink-500 border-pink-500/20 dark:bg-pink-500/20",
    orange: "bg-orange-500/10 text-orange-500 border-orange-500/20 dark:bg-orange-500/20",
    gray: "bg-muted text-muted-foreground border-border dark:bg-muted/40",
};

export function ArchiveVaultClient({ hasPinLock }: ArchiveVaultClientProps) {
    const [unlocked, setUnlocked] = useState(!hasPinLock);
    const [pin, setPin] = useState("");
    const [isVerifying, setIsVerifying] = useState(false);
    const [pinError, setPinError] = useState(false);

    // Vault Data State
    const [recordings, setRecordings] = useState<Recording[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [isLoadingData, setIsLoadingData] = useState(false);

    // Filter/Search State
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
        null,
    );

    // Mini Player State
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [audioDuration, setAudioDuration] = useState(0);
    const [audioCurrentTime, setAudioCurrentTime] = useState(0);
    const [volume, setVolume] = useState(75);
    const [isMuted, setIsMuted] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Action In-flight State
    const [actionId, setActionId] = useState<string | null>(null);

    // Fetch recordings & categories once unlocked
    useEffect(() => {
        if (!unlocked) return;

        async function fetchVaultData() {
            setIsLoadingData(true);
            try {
                const [recordingsRes, categoriesRes] = await Promise.all([
                    fetch("/api/archive/recordings").then((r) => r.json()),
                    fetch("/api/archive/categories").then((r) => r.json()),
                ]);

                setRecordings(recordingsRes.recordings ?? []);
                setCategories(categoriesRes.categories ?? []);
            } catch (_err) {
                toast.error("Failed to load vault items.");
            } finally {
                setIsLoadingData(false);
            }
        }

        void fetchVaultData();
    }, [unlocked]);

    // Handle PIN Verification
    const handleVerifyPin = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!pin.trim()) return;

        setIsVerifying(true);
        setPinError(false);

        try {
            const res = await fetch("/api/archive/vault", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pin }),
            });
            const data = await res.json();

            if (res.ok && data.valid) {
                setUnlocked(true);
                toast.success("Vault unlocked successfully.");
            } else {
                setPinError(true);
                setPin("");
                toast.error("Incorrect PIN. Please try again.");
            }
        } catch {
            toast.error("An error occurred during verification.");
        } finally {
            setIsVerifying(false);
        }
    };

    // Format utility helpers
    const formatDuration = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes.toString()}:${seconds.toString().padStart(2, "0")}`;
    };

    const formatFilesize = (bytes: number) => {
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    // Unarchive Recording Action
    const handleRestore = async (recording: Recording) => {
        setActionId(recording.id);
        try {
            const res = await fetch(`/api/recordings/${recording.id}/archive`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ archive: false }),
            });
            if (!res.ok) throw new Error();

            toast.success(`"${recording.filename}" restored to workstation.`);
            setRecordings((prev) => prev.filter((r) => r.id !== recording.id));
            if (playingId === recording.id) {
                handleStopAudio();
            }
        } catch {
            toast.error("Failed to restore recording.");
        } finally {
            setActionId(null);
        }
    };

    // Delete Recording Action
    const handleDelete = async (recording: Recording) => {
        if (
            !confirm(
                `Are you sure you want to permanently delete "${recording.filename}"? This cannot be undone.`,
            )
        ) {
            return;
        }

        setActionId(recording.id);
        try {
            const res = await fetch(`/api/recordings/${recording.id}`, {
                method: "DELETE",
            });
            if (!res.ok) throw new Error();

            toast.success("Recording deleted permanently.");
            setRecordings((prev) => prev.filter((r) => r.id !== recording.id));
            if (playingId === recording.id) {
                handleStopAudio();
            }
        } catch {
            toast.error("Failed to delete recording.");
        } finally {
            setActionId(null);
        }
    };

    // Audio Playback Handling
    const handlePlayAudio = (recording: Recording) => {
        if (playingId === recording.id) {
            // Toggle
            if (audioRef.current) {
                if (audioRef.current.paused) {
                    void audioRef.current.play();
                } else {
                    audioRef.current.pause();
                }
            }
        } else {
            // Play new
            setPlayingId(recording.id);
            setAudioCurrentTime(0);
            if (audioRef.current) {
                audioRef.current.src = `/api/recordings/${recording.id}/audio`;
                void audioRef.current.play();
            }
        }
    };

    const handleStopAudio = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = "";
        }
        setPlayingId(null);
        setAudioCurrentTime(0);
    };

    // Sync audio events
    const onPlay = () => {};
    const onPause = () => {};
    const onTimeUpdate = () => {
        if (audioRef.current) {
            setAudioCurrentTime(audioRef.current.currentTime);
        }
    };
    const onLoadedMetadata = () => {
        if (audioRef.current) {
            setAudioDuration(audioRef.current.duration);
        }
    };
    const onAudioEnded = () => {
        setPlayingId(null);
        setAudioCurrentTime(0);
    };

    // Update volume
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = isMuted ? 0 : volume / 100;
        }
    }, [volume, isMuted]);

    // Handle seeker changes
    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = Number(e.target.value);
        if (audioRef.current) {
            audioRef.current.currentTime = val;
            setAudioCurrentTime(val);
        }
    };

    // Filtered recordings computed view
    const filteredRecordings = useMemo(() => {
        return recordings.filter((r) => {
            const matchSearch = r.filename
                .toLowerCase()
                .includes(searchQuery.toLowerCase());
            const matchCategory = selectedCategoryId
                ? r.categoryIds.includes(selectedCategoryId)
                : true;
            return matchSearch && matchCategory;
        });
    }, [recordings, searchQuery, selectedCategoryId]);

    // Render Lock Screen
    if (!unlocked) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background px-4">
                <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(var(--primary-rgb),0.08),transparent_50%)]" />
                <Card
                    className={cn(
                        "w-full max-w-md backdrop-blur-xl bg-card/75 border border-border/80 shadow-2xl transition-all duration-300",
                        pinError && "animate-shake border-destructive/50",
                    )}
                >
                    <CardHeader className="text-center pb-2">
                        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <Lock className="size-6 animate-pulse" />
                        </div>
                        <CardTitle className="text-2xl font-bold tracking-tight">
                            Vault Locked
                        </CardTitle>
                        <CardDescription className="text-muted-foreground">
                            Enter your PIN to access secure archived recordings.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form
                            onSubmit={(e) => void handleVerifyPin(e)}
                            className="space-y-4"
                        >
                            <div className="space-y-2">
                                <Input
                                    type="password"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    maxLength={12}
                                    placeholder="••••"
                                    value={pin}
                                    onChange={(e) =>
                                        setPin(
                                            e.target.value.replace(/\D/g, ""),
                                        )
                                    }
                                    className="text-center text-2xl tracking-widest h-12"
                                    disabled={isVerifying}
                                    autoFocus
                                />
                            </div>
                            <Button
                                type="submit"
                                className="w-full h-10"
                                disabled={isVerifying || pin.length < 4}
                            >
                                {isVerifying ? (
                                    <>
                                        <Loader2 className="mr-2 size-4 animate-spin" />
                                        Unlocking...
                                    </>
                                ) : (
                                    "Unlock Vault"
                                )}
                            </Button>
                            <Button
                                asChild
                                variant="ghost"
                                className="w-full text-xs text-muted-foreground"
                            >
                                <Link
                                    href="/dashboard"
                                    className="flex items-center justify-center gap-1"
                                >
                                    <ArrowLeft className="size-3" /> Back to
                                    Dashboard
                                </Link>
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background pb-32">
            {/* Top Navigation / Header */}
            <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
                <div className="flex h-14 items-center justify-between px-6">
                    <div className="flex items-center gap-3">
                        <Button
                            asChild
                            variant="ghost"
                            size="icon-sm"
                            className="rounded-full"
                        >
                            <Link href="/dashboard">
                                <ArrowLeft className="size-4" />
                            </Link>
                        </Button>
                        <div className="flex items-center gap-2">
                            <Archive className="size-5 text-primary" />
                            <h1 className="text-lg font-semibold tracking-tight">
                                Archive Vault
                            </h1>
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                                {recordings.length}
                            </span>
                        </div>
                    </div>

                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setUnlocked(false);
                            setPin("");
                            handleStopAudio();
                        }}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <LockOpen className="mr-1.5 size-4" /> Lock Vault
                    </Button>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
                {/* Search & Categories Bar */}
                <div className="flex flex-col sm:flex-row gap-4 justify-between items-stretch sm:items-center">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                        <Input
                            placeholder="Search archived files..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-9"
                        />
                    </div>

                    {/* Category quick selectors */}
                    {categories.length > 0 && (
                        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
                            <Button
                                variant={
                                    selectedCategoryId === null
                                        ? "default"
                                        : "outline"
                                }
                                size="sm"
                                onClick={() => setSelectedCategoryId(null)}
                                className="rounded-full h-8"
                            >
                                All
                            </Button>
                            {categories.map((cat) => (
                                <Button
                                    key={cat.id}
                                    variant={
                                        selectedCategoryId === cat.id
                                            ? "default"
                                            : "outline"
                                    }
                                    size="sm"
                                    onClick={() =>
                                        setSelectedCategoryId(cat.id)
                                    }
                                    className="rounded-full h-8"
                                >
                                    {cat.name}
                                </Button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Recordings Grid / Table */}
                {isLoadingData ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3">
                        <Loader2 className="size-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">
                            Opening secure vault...
                        </p>
                    </div>
                ) : filteredRecordings.length === 0 ? (
                    <div className="flex flex-col items-center justify-center border border-dashed border-border/60 rounded-xl py-24 text-center gap-4">
                        <div className="rounded-full bg-muted/40 p-4">
                            <Archive className="size-8 text-muted-foreground/50" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-base font-semibold">
                                No recordings found
                            </p>
                            <p className="text-sm text-muted-foreground max-w-sm px-4">
                                {searchQuery || selectedCategoryId
                                    ? "No files match your search parameters."
                                    : "Move recordings to the archive vault from the main workstation settings or dashboard rows."}
                            </p>
                        </div>
                        {(searchQuery || selectedCategoryId) && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    setSearchQuery("");
                                    setSelectedCategoryId(null);
                                }}
                            >
                                Clear Filters
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {filteredRecordings.map((rec) => {
                            const isCurrentPlaying = playingId === rec.id;
                            const isAudioPlaying =
                                isCurrentPlaying &&
                                audioRef.current &&
                                !audioRef.current.paused;

                            return (
                                <Card
                                    key={rec.id}
                                    className={cn(
                                        "transition-all duration-200 border-border/50 hover:border-border shadow-xs hover:shadow-md",
                                        isCurrentPlaying &&
                                            "ring-1 ring-primary/40 border-primary/40 bg-accent/10",
                                    )}
                                >
                                    <div className="flex flex-col md:flex-row md:items-center justify-between p-4 gap-4">
                                        <div className="flex items-start gap-3 flex-1 min-w-0">
                                            <Button
                                                variant="secondary"
                                                size="icon"
                                                onClick={() =>
                                                    handlePlayAudio(rec)
                                                }
                                                className="rounded-full size-10 shrink-0 bg-primary/5 hover:bg-primary/10 text-primary border border-primary/10 active:scale-[0.95] transition-all"
                                                disabled={actionId === rec.id}
                                            >
                                                {isAudioPlaying ? (
                                                    <Pause className="size-4 fill-primary" />
                                                ) : (
                                                    <Play className="size-4 fill-primary translate-x-0.5" />
                                                )}
                                            </Button>

                                            <div className="space-y-1 min-w-0">
                                                <h3 className="font-semibold text-sm truncate pr-2">
                                                    {rec.filename}
                                                </h3>
                                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                                                    <span className="flex items-center gap-1">
                                                        <Clock className="size-3" />
                                                        {new Date(
                                                            rec.startTime,
                                                        ).toLocaleString(
                                                            undefined,
                                                            {
                                                                dateStyle:
                                                                    "medium",
                                                                timeStyle:
                                                                    "short",
                                                            },
                                                        )}
                                                    </span>
                                                    <span>•</span>
                                                    <span>
                                                        {formatDuration(
                                                            rec.duration,
                                                        )}
                                                    </span>
                                                    <span>•</span>
                                                    <span className="flex items-center gap-1">
                                                        <HardDrive className="size-3" />
                                                        {formatFilesize(
                                                            rec.filesize,
                                                        )}
                                                    </span>
                                                </div>

                                                {/* Associated Category Badges */}
                                                {rec.categoryIds.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5 pt-1.5">
                                                        {rec.categoryIds.map(
                                                            (catId) => {
                                                                const catObj =
                                                                    categories.find(
                                                                        (c) =>
                                                                            c.id ===
                                                                            catId,
                                                                    );
                                                                if (!catObj)
                                                                    return null;
                                                                return (
                                                                    <span
                                                                        key={
                                                                            catId
                                                                        }
                                                                        className={cn(
                                                                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border",
                                                                            colorMap[
                                                                                catObj
                                                                                    .color
                                                                            ] ||
                                                                                colorMap.gray,
                                                                        )}
                                                                    >
                                                                        <Folder className="size-2.5" />
                                                                        {
                                                                            catObj.name
                                                                        }
                                                                    </span>
                                                                );
                                                            },
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center justify-end gap-2 border-t md:border-t-0 pt-3 md:pt-0 border-border/40">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    void handleRestore(rec)
                                                }
                                                disabled={actionId !== null}
                                                className="h-8 text-xs gap-1.5"
                                            >
                                                {actionId === rec.id ? (
                                                    <Loader2 className="size-3 animate-spin" />
                                                ) : (
                                                    <ArchiveRestore className="size-3.5" />
                                                )}
                                                Restore
                                            </Button>

                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    void handleDelete(rec)
                                                }
                                                disabled={actionId !== null}
                                                className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive border-border/60 hover:border-destructive/30 gap-1.5"
                                            >
                                                {actionId === rec.id ? (
                                                    <Loader2 className="size-3 animate-spin" />
                                                ) : (
                                                    <Trash2 className="size-3.5" />
                                                )}
                                                Delete
                                            </Button>
                                        </div>
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </main>

            {/* Global Preview Floating Audio Player */}
            {playingId && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-xl px-4 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <Card className="backdrop-blur-xl bg-card/90 border border-border/80 shadow-2xl dark:shadow-[0_0_30px_rgba(0,0,0,0.6)]">
                        <CardContent className="p-4 flex flex-col gap-3">
                            <div className="flex items-center justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs font-semibold text-primary uppercase tracking-wider font-mono">
                                        Vault Preview Player
                                    </p>
                                    <p className="text-sm font-semibold truncate">
                                        {recordings.find(
                                            (r) => r.id === playingId,
                                        )?.filename || "Playing..."}
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    className="rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/40"
                                    onClick={handleStopAudio}
                                >
                                    <Trash2 className="size-4 text-destructive" />
                                </Button>
                            </div>

                            {/* Seeker / Controls */}
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] font-mono text-muted-foreground min-w-[32px] text-right">
                                    {formatDuration(audioCurrentTime * 1000)}
                                </span>
                                <input
                                    type="range"
                                    min={0}
                                    max={audioDuration || 0}
                                    value={audioCurrentTime}
                                    onChange={handleSeek}
                                    className="flex-1 accent-primary h-1 bg-muted rounded-lg appearance-none cursor-pointer"
                                />
                                <span className="text-[10px] font-mono text-muted-foreground min-w-[32px]">
                                    {formatDuration(audioDuration * 1000 || 0)}
                                </span>
                            </div>

                            <div className="flex items-center justify-between mt-1 pt-1 border-t border-border/30">
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        className="rounded-full bg-accent/40 hover:bg-accent text-foreground"
                                        onClick={() => {
                                            if (audioRef.current) {
                                                if (audioRef.current.paused) {
                                                    void audioRef.current.play();
                                                } else {
                                                    audioRef.current.pause();
                                                }
                                            }
                                        }}
                                    >
                                        {audioRef.current &&
                                        !audioRef.current.paused ? (
                                            <Pause className="size-3.5 fill-foreground" />
                                        ) : (
                                            <Play className="size-3.5 fill-foreground translate-x-0.5" />
                                        )}
                                    </Button>
                                </div>

                                {/* Volume Bar */}
                                <div className="flex items-center gap-2 max-w-[120px]">
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onClick={() => setIsMuted(!isMuted)}
                                        className="text-muted-foreground hover:text-foreground p-0 h-6 w-6"
                                    >
                                        {isMuted || volume === 0 ? (
                                            <VolumeX className="size-3.5" />
                                        ) : (
                                            <Volume2 className="size-3.5" />
                                        )}
                                    </Button>
                                    <input
                                        type="range"
                                        min={0}
                                        max={100}
                                        value={isMuted ? 0 : volume}
                                        onChange={(e) => {
                                            setVolume(Number(e.target.value));
                                            setIsMuted(false);
                                        }}
                                        className="w-16 accent-primary h-1 bg-muted rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Hidden HTML5 Audio Element */}
            <audio
                ref={audioRef}
                onPlay={onPlay}
                onPause={onPause}
                onTimeUpdate={onTimeUpdate}
                onLoadedMetadata={onLoadedMetadata}
                onEnded={onAudioEnded}
                className="hidden"
            >
                <track kind="captions" />
            </audio>
        </div>
    );
}
