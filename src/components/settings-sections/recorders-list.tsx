"use client";

import { Smartphone } from "lucide-react";
import { SettingsGroup } from "@/components/settings/section-header";
import type { RecorderDevice } from "@/types/device";

/**
 * Recorders found in the connected Plaud account (`plaud_devices`, filled
 * by sync). Left out entirely when there are none, so a first-run account
 * doesn't get an empty heading.
 */
export function RecordersList({ devices }: { devices: RecorderDevice[] }) {
    if (devices.length === 0) return null;
    return (
        <SettingsGroup
            title="Recorders"
            description="Found in your Plaud account"
        >
            <ul className="flex flex-col divide-y divide-hairline border-y border-hairline">
                {devices.map((device) => (
                    <li
                        key={device.serialNumber}
                        className="flex items-center gap-3.5 py-3"
                    >
                        <span
                            aria-hidden="true"
                            className="squircle flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-surface text-foreground dark:bg-accent"
                        >
                            <Smartphone className="size-5" />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.75">
                            <span className="truncate text-row font-semibold text-strong">
                                {device.name || device.model}
                            </span>
                            {device.name && device.model ? (
                                <span className="truncate text-ui text-subtle">
                                    {device.model}
                                </span>
                            ) : null}
                        </span>
                        <span className="shrink-0 font-mono text-small leading-4 text-subtle max-sm:hidden">
                            {device.serialNumber}
                        </span>
                    </li>
                ))}
            </ul>
        </SettingsGroup>
    );
}
