"use client";

import type { SettingsSection } from "@/types/settings";
import { ApiKeysSection } from "./settings/api-keys-section";
import { WebhooksSection } from "./settings/webhooks-section";
import { BillingSection } from "./settings-sections/billing-section";
import { DevSection } from "./settings-sections/dev-section";
import { DisplaySection } from "./settings-sections/display-section";
import { ExportSection } from "./settings-sections/export-section";
import { NotificationsSection } from "./settings-sections/notifications-section";
import { PlaudAccountSection } from "./settings-sections/plaud-account-section";
import { PlaybackSection } from "./settings-sections/playback-section";
import {
    type Provider,
    ProvidersSection,
} from "./settings-sections/providers-section";
import { StorageSection } from "./settings-sections/storage-section";
import { SummarySection } from "./settings-sections/summary-section";
import { SyncSection } from "./settings-sections/sync-section";
import { TranscriptionSection } from "./settings-sections/transcription-section";

interface SettingsContentProps {
    activeSection: SettingsSection;
    /** Forwarded to `ProvidersSection`; null while loading. */
    providers: Provider[] | null;
    /** Forwarded to `ProvidersSection`; see its prop doc. */
    onProvidersChange: (providers: Provider[]) => void;
    /** Forwarded to `ProvidersSection`; see its prop doc. */
    providersLoadFailed?: boolean;
    /** Forwarded to `ProvidersSection` as `onRetry`. */
    onRetryProviders?: () => void;
    onReRunOnboarding?: () => void;
    isHosted?: boolean;
    /** Forwarded to `PlaudAccountSection`; see its prop doc. */
    onPlaudReconnected?: () => void;
}

export function SettingsContent({
    activeSection,
    providers,
    onProvidersChange,
    providersLoadFailed,
    onRetryProviders,
    onReRunOnboarding,
    isHosted = false,
    onPlaudReconnected,
}: SettingsContentProps) {
    switch (activeSection) {
        case "providers":
            return (
                <ProvidersSection
                    providers={providers}
                    onProvidersChange={onProvidersChange}
                    loadFailed={providersLoadFailed}
                    onRetry={onRetryProviders}
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
            return <PlaudAccountSection onReconnected={onPlaudReconnected} />;
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
        case "billing":
            if (!isHosted) return null;
            return <BillingSection />;
        case "dev":
            if (process.env.NODE_ENV === "production") return null;
            return <DevSection />;
        default:
            return null;
    }
}
