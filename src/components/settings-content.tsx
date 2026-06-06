"use client";

import type { SettingsSection } from "@/types/settings";
import { ArchiveVaultSection } from "./settings-sections/archive-vault-section";
import { ApiKeysSection } from "./settings/api-keys-section";
import { WebhooksSection } from "./settings/webhooks-section";
import { DevSection } from "./settings-sections/dev-section";
import { DisplaySection } from "./settings-sections/display-section";
import { ExportSection } from "./settings-sections/export-section";
import { NotificationsSection } from "./settings-sections/notifications-section";
import { PlaudAccountSection } from "./settings-sections/plaud-account-section";
import { PlaybackSection } from "./settings-sections/playback-section";
import { ProvidersSection } from "./settings-sections/providers-section";
import { StorageSection } from "./settings-sections/storage-section";
import { SummarySection } from "./settings-sections/summary-section";
import { SyncSection } from "./settings-sections/sync-section";
import { TranscriptionSection } from "./settings-sections/transcription-section";

interface Provider {
    id: string;
    provider: string;
    baseUrl: string | null;
    nickname: string | null;
    defaultModel: string | null;
    isDefaultTranscription: boolean;
    isDefaultEnhancement: boolean;
    createdAt: Date;
}

const EMPTY_PROVIDERS: Provider[] = [];

interface SettingsContentProps {
    activeSection: SettingsSection;
    initialProviders?: Provider[];
    onReRunOnboarding?: () => void;
    isHosted?: boolean;
}

export function SettingsContent({
    activeSection,
    initialProviders = EMPTY_PROVIDERS,
    onReRunOnboarding,
    isHosted = false,
}: SettingsContentProps) {
    switch (activeSection) {
        case "providers":
            return (
                <ProvidersSection
                    initialProviders={initialProviders}
                    isHosted={isHosted}
                />
            );
        case "api-keys":
            return <ApiKeysSection />;
        case "webhooks":
            return <WebhooksSection />;
        case "transcription":
            return <TranscriptionSection />;
        case "summary":
            return <SummarySection />;
        case "sync":
            return <SyncSection />;
        case "plaud-account":
            return <PlaudAccountSection />;
        case "playback":
            return <PlaybackSection />;
        case "display":
            return <DisplaySection />;
        case "notifications":
            return <NotificationsSection />;
        case "export":
            return <ExportSection onReRunOnboarding={onReRunOnboarding} />;
        case "storage":
            return <StorageSection isHosted={isHosted} />;
        case "archive":
            return <ArchiveVaultSection />;
        case "dev":
            if (process.env.NODE_ENV === "production") return null;
            return <DevSection />;
        default:
            return null;
    }
}
