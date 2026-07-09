import type { CampaignKind } from "@/db/queries/email-campaigns";

export type { CampaignKind };

export interface Recipient {
    kind: "user" | "subscriber";
    id: string;
    email: string;
    name: string | null;
    marketingConsent: boolean | null;
}

export interface RenderedEmail {
    html: string;
    text?: string;
}

export interface CampaignDefinition {
    slug: string;
    subject: string;
    kind: CampaignKind;
    audience: () => AsyncIterable<Recipient>;
    render: (
        recipient: Recipient,
        unsubscribeUrl: string | null,
    ) => Promise<RenderedEmail>;
    fromAddress?: string;
}
