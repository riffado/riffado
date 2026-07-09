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
    /** Settings -> Billing deep link (add a card). */
    billingUrl: string;
    /** Settings -> Export deep link. */
    exportUrl: string;
    /** Self-host docs / repo link. */
    selfHostUrl: string;
}

// DRAFT COPY: review before sending. Sent to grandfathered hosted users
// on launch day. Tone: respectful, no surprise, the 30-day window is the
// grace. Positioning rules: name the price plainly, self-host is the free
// path, no disparagement.
export function TransitionStartEmail({
    transitionEndsAt,
    amountValue,
    amountCurrency,
    billingUrl,
    exportUrl,
    selfHostUrl,
}: Props) {
    return (
        <EmailLayout
            previewText={`Riffado Hosted is now a paid product. You keep full Pro access free until ${formatEmailDate(transitionEndsAt)}.`}
            footerLink={{ href: billingUrl, label: "Manage billing" }}
        >
            <Heading style={emailStyles.h1}>
                Riffado Hosted is now a paid product.
            </Heading>
            <Text style={emailStyles.text}>
                You've been using Riffado on our hosted servers for free. From
                today, hosted runs as a paid plan: Hosted Pro at {amountValue}{" "}
                {amountCurrency}/month. Nothing changes for you right now: you
                keep full Pro access, free, until{" "}
                <strong>{formatEmailDate(transitionEndsAt)}</strong>.
            </Text>
            <Text style={emailStyles.text}>
                Add a card before then to keep everything running and lock{" "}
                <strong>founding-member pricing</strong> at {amountValue}{" "}
                {amountCurrency}/month for as long as your subscription stays
                active, even when the price goes up for everyone else.
            </Text>
            <Text style={emailStyles.text}>
                Hosted Pro includes 50 GB storage, 15 hours of Mynah
                transcription per month, unlimited devices, and background sync
                that keeps pulling recordings even when your browser is closed.
            </Text>
            <Section style={emailStyles.buttonSection}>
                <Button style={emailStyles.button} href={billingUrl}>
                    Add a card
                </Button>
            </Section>
            <Text style={emailStyles.text}>
                Prefer to run it yourself? Riffado is open source, and you can{" "}
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
