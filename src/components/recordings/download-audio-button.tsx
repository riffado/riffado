"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { recordingAudioDownloadPath } from "@/lib/recordings/filename";

export function DownloadAudioButton({ recordingId }: { recordingId: string }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon-sm">
                    <a
                        href={recordingAudioDownloadPath(recordingId)}
                        download
                        rel="nofollow noreferrer"
                        aria-label="Download original audio"
                    >
                        <Download className="size-4" />
                    </a>
                </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
                Download original audio
            </TooltipContent>
        </Tooltip>
    );
}
