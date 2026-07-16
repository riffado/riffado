import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { formatEmailDate } from "./format-date";
import { emailStyles } from "./styles";

interface Props {
    /** End of the free Pro window (when the account goes read-only). */
    transitionEndsAt: Date;
    /** Decimal price string, e.g. "5.00". */
    amountValue: string;
    /** ISO currency code, e.g. "EUR". */
    amountCurrency: string;
    /** Whether a founding monthly spot is currently available. */
    foundingOfferAvailable: boolean;
    foundingCapacity: number;
    /** Settings -> Billing deep link (add a card). */
    billingUrl: string;
    /** Settings -> Export deep link. */
    exportUrl: string;
    /** Self-host docs / repo link. */
    selfHostUrl: string;
}

// Sent to grandfathered hosted users on launch day. Tone: respectful, no
// surprise; the 30-day window is the grace. Positioning rules: name the
// currently available price plainly, self-host is the free path, and never
// imply founding capacity is guaranteed until the transition deadline.
export function TransitionStartEmail({
    transitionEndsAt,
    amountValue,
    amountCurrency,
    foundingOfferAvailable,
    foundingCapacity,
    billingUrl,
    exportUrl,
    selfHostUrl,
}: Props) {
    return (
        <EmailLayout
            previewText={`Hosted Pro is live. You keep full access free until ${formatEmailDate(transitionEndsAt)}.`}
            footerLink={{ href: billingUrl, label: "Manage billing" }}
        >
            <Heading style={emailStyles.h1}>Hosted Pro is live.</Heading>
            <Text style={emailStyles.text}>
                Until now, you've used Riffado on our hosted servers for free.
                Hosted is now becoming a paid product. Nothing changes
                immediately: you keep full Hosted Pro access free until{" "}
                <strong>{formatEmailDate(transitionEndsAt)}</strong>.
            </Text>
            {foundingOfferAvailable ? (
                <Text style={emailStyles.text}>
                    The first {foundingCapacity} paid monthly members can
                    subscribe for the founding price of {amountValue}{" "}
                    {amountCurrency}/month. That price stays locked for as long
                    as the subscription remains active. Founding spots are
                    available on a first-paid, first-served basis.
                </Text>
            ) : (
                <Text style={emailStyles.text}>
                    Monthly Hosted Pro is available for {amountValue}{" "}
                    {amountCurrency}/month.
                </Text>
            )}
            <Text style={emailStyles.text}>
                Hosted Pro includes 50 GB storage, 15 hours of Mynah
                transcription per month, unlimited devices, and background sync
                that keeps pulling recordings even when your browser is closed.
            </Text>
            <Section style={emailStyles.buttonSection}>
                <Button style={emailStyles.button} href={billingUrl}>
                    See billing options
                </Button>
            </Section>
            <Text style={emailStyles.text}>
                If you don't choose a plan before{" "}
                {formatEmailDate(transitionEndsAt)}, your Hosted account becomes
                read-only. Nothing will be deleted: existing recordings remain
                playable and exportable, while sync, uploads, and new
                transcriptions pause.
            </Text>
            <Text style={emailStyles.text}>
                Prefer not to subscribe? That's fine. Riffado is open source,
                and you can{" "}
                <a href={selfHostUrl} style={emailStyles.link}>
                    self-host for free
                </a>{" "}
                and keep everything. Or{" "}
                <a href={exportUrl} style={emailStyles.link}>
                    export your data
                </a>{" "}
                anytime. Your recordings, transcripts, and summaries are yours
                either way.
            </Text>
        </EmailLayout>
    );
}
