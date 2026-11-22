"use client";

import type * as React from "react";
import type { RecorderDevice } from "@/types/device";
import type { SettingsPage } from "@/types/settings";
import { ApiKeysSection } from "./settings/api-keys-section";
import { WebhooksSection } from "./settings/webhooks-section";
import { SECTION_LOCATION } from "./settings-nav-config";
import { BillingSection } from "./settings-sections/billing-section";
import { DevSection } from "./settings-sections/dev-section";
import { DisplaySection } from "./settings-sections/display-section";
import { ExportSection } from "./settings-sections/export-section";
import { NotificationsSection } from "./settings-sections/notifications-section";
import { PlaudAccountSection } from "./settings-sections/plaud-account-section";
import { PlaybackSection } from "./settings-sections/playback-section";
import { PromptManager } from "./settings-sections/prompt-manager";
import {
    type Provider,
    ProvidersSection,
} from "./settings-sections/providers-section";
import { RecordersList } from "./settings-sections/recorders-list";
import { StorageSection } from "./settings-sections/storage-section";
import { SummarySection } from "./settings-sections/summary-section";
import { SyncSection } from "./settings-sections/sync-section";
import { TranscriptionSection } from "./settings-sections/transcription-section";

interface SettingsContentProps {
    page: SettingsPage;
    /** Shared provider list for AI for summaries and Transcription; null while loading. */
    providers: Provider[] | null;
    /** Receives the provider list re-read after a change. */
    onProvidersChange: (providers: Provider[]) => void;
    /** True when the provider list could not be loaded. */
    providersLoadFailed?: boolean;
    /** Retries loading the provider list. */
    onRetryProviders?: () => void;
    onReRunOnboarding?: () => void;
    isHosted?: boolean;
    /** Recorders linked to the Plaud account, for Recorders. */
    devices?: RecorderDevice[];
    /** Last successful Plaud sync (ISO string), or null. */
    plaudLastSyncAt?: string | null;
    /** Forwarded to `PlaudAccountSection`; see its prop doc. */
    onPlaudReconnected?: () => void;
    /** Forwarded to `PlaudAccountSection` as `onDisconnected`. */
    onPlaudDisconnected?: () => void;
}

/** Scroll target for an old section id that now lives inside a page. */
function Anchor({
    section,
    children,
}: {
    section: keyof typeof SECTION_LOCATION;
    children: React.ReactNode;
}) {
    return (
        <div id={SECTION_LOCATION[section].anchor} className="scroll-mt-10">
            {children}
        </div>
    );
}

/**
 * The sections that make up one settings page. Pages that merge several
 * old sections render all of them, in order, with every control intact.
 */
export function SettingsContent({
    page,
    providers,
    onProvidersChange,
    providersLoadFailed,
    onRetryProviders,
    onReRunOnboarding,
    isHosted = false,
    devices = [],
    plaudLastSyncAt = null,
    onPlaudReconnected,
    onPlaudDisconnected,
}: SettingsContentProps) {
    switch (page) {
        case "plan":
            if (!isHosted) return null;
            return <BillingSection />;
        case "recorders":
            return (
                <>
                    <Anchor section="plaud-account">
                        <PlaudAccountSection
                            onReconnected={onPlaudReconnected}
                            onDisconnected={onPlaudDisconnected}
                            lastSyncAt={plaudLastSyncAt}
                        />
                    </Anchor>
                    <RecordersList devices={devices} />
                    <Anchor section="sync">
                        <SyncSection />
                    </Anchor>
                </>
            );
        case "transcription":
            return (
                <TranscriptionSection
                    providers={providers}
                    onProvidersChange={onProvidersChange}
                />
            );
        case "ai":
            return (
                <>
                    <Anchor section="providers">
                        <ProvidersSection
                            providers={providers}
                            onProvidersChange={onProvidersChange}
                            loadFailed={providersLoadFailed}
                            onRetry={onRetryProviders}
                            isHosted={isHosted}
                        />
                    </Anchor>
                    <Anchor section="summary">
                        <SummarySection />
                    </Anchor>
                    <PromptManager />
                </>
            );
        case "storage":
            return <StorageSection isHosted={isHosted} />;
        case "api":
            return (
                <>
                    <Anchor section="api-keys">
                        <ApiKeysSection />
                    </Anchor>
                    <Anchor section="webhooks">
                        <WebhooksSection />
                    </Anchor>
                </>
            );
        case "export":
            return <ExportSection onReRunOnboarding={onReRunOnboarding} />;
        case "preferences":
            return (
                <>
                    <Anchor section="playback">
                        <PlaybackSection />
                    </Anchor>
                    <Anchor section="display">
                        <DisplaySection />
                    </Anchor>
                    <Anchor section="notifications">
                        <NotificationsSection />
                    </Anchor>
                </>
            );
        case "dev":
            if (process.env.NODE_ENV === "production") return null;
            return <DevSection />;
        default:
            return null;
    }
}
