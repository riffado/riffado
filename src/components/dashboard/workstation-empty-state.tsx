"use client";

import { Mic, RefreshCw, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
    isSyncing: boolean;
    onSync: () => void;
    onUpload: () => void;
}

/**
 * Shown when the user has no recordings yet (and no in-flight upload).
 * Offers the two paths into having content: sync from a Plaud device
 * (the common case) or upload an audio file from disk.
 */
export function WorkstationEmptyState({ isSyncing, onSync, onUpload }: Props) {
    const t = useTranslations("dashboard");
    return (
        <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
                <Mic className="mb-4 size-16 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-semibold">
                    {t("noRecordingsTitle")}
                </h3>
                <p className="mb-6 max-w-md text-center text-sm text-muted-foreground">
                    {t("emptyStateBody")}
                </p>
                <div className="flex gap-2">
                    <Button onClick={onSync} disabled={isSyncing}>
                        {isSyncing ? (
                            <>
                                <RefreshCw className="mr-2 size-4 animate-spin" />
                                {t("syncing")}
                            </>
                        ) : (
                            <>
                                <RefreshCw className="mr-2 size-4" />
                                {t("syncDevice")}
                            </>
                        )}
                    </Button>
                    <Button variant="outline" onClick={onUpload}>
                        <Upload className="mr-2 size-4" />
                        {t("uploadAudio")}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
