import React from "react";
import { hostedUserAudience } from "@/lib/email/audience/hosted-users";
import type { CampaignDefinition, Recipient } from "@/lib/email/types";
import { env } from "@/lib/env";
import { RebrandAnnouncementEmail } from "@/lib/notifications/email-templates/rebrand-announcement-email";
import { renderEmailHtml } from "@/lib/notifications/render-email";

export const REBRAND_CAMPAIGN_SLUG = "rebrand-openplaud-to-riffado-2026-06";

function deriveRecipientName(recipient: Recipient): string | null {
    if (!recipient.name) return null;
    const first = recipient.name.trim().split(/\s+/)[0];
    if (!first) return null;
    return first.length >= 2 ? first : null;
}

export function buildRebrandCampaign(): CampaignDefinition {
    const appUrl = env.APP_URL?.replace(/\/$/, "");
    if (!appUrl) {
        throw new Error(
            "rebrand-announcement: APP_URL is not set; cannot build absolute URLs for the email",
        );
    }
    const rebrandUrl = `${appUrl}/rebrand`;
    const loginUrl = `${appUrl}/login`;

    return {
        slug: REBRAND_CAMPAIGN_SLUG,
        subject: "OpenPlaud is now Riffado",
        kind: "announcement",
        audience: () =>
            hostedUserAudience({
                verifiedOnly: true,
                requireMarketingConsent: false,
            }),
        render: async (recipient, unsubscribeUrl) => {
            if (!unsubscribeUrl) {
                throw new Error(
                    "rebrand-announcement: unsubscribeUrl is null for announcement-class campaign",
                );
            }
            const html = await renderEmailHtml(
                React.createElement(RebrandAnnouncementEmail, {
                    recipientName: deriveRecipientName(recipient),
                    rebrandUrl,
                    loginUrl,
                    unsubscribeUrl,
                }),
            );
            return { html };
        },
    };
}
