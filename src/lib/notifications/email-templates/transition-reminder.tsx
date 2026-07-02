import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { emailStyles } from "./styles";

interface Props {
    /** Days remaining in the free Pro window. */
    daysLeft: number;
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

function formatDate(d: Date): string {
    return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

// DRAFT COPY — review before sending. Sent ~3 days before the free Pro
// window closes. States the fork plainly: subscribe, self-host, or go
// read-only. No deletion threat — grandfathered data is never deleted.
export function TransitionReminderEmail({
    daysLeft,
    transitionEndsAt,
    amountValue,
    amountCurrency,
    billingUrl,
    exportUrl,
    selfHostUrl,
}: Props) {
    return (
        <EmailLayout
            previewText={`${daysLeft} day${daysLeft === 1 ? "" : "s"} of free Hosted Pro left. Add a card to keep sync and transcription.`}
            footerLink={{ href: billingUrl, label: "Manage billing" }}
        >
            <Heading style={emailStyles.h1}>
                {daysLeft} day{daysLeft === 1 ? "" : "s"} of free Hosted Pro
                left.
            </Heading>
            <Text style={emailStyles.text}>
                Your free hosted window closes on{" "}
                <strong>{formatDate(transitionEndsAt)}</strong>. To keep
                background sync, new transcriptions, and uploads running, add a
                card and lock founding-member pricing — {amountValue}{" "}
                {amountCurrency}/month for life.
            </Text>
            <Section style={emailStyles.buttonSection}>
                <Button style={emailStyles.button} href={billingUrl}>
                    Subscribe
                </Button>
            </Section>
            <Text style={emailStyles.text}>
                If you'd rather not subscribe, that's fine — nothing gets
                deleted. After {formatDate(transitionEndsAt)} your account goes
                read-only: your recordings stay playable and exportable, but
                sync and new transcriptions pause until you subscribe. You can{" "}
                <a href={selfHostUrl} style={emailStyles.link}>
                    self-host for free
                </a>{" "}
                or{" "}
                <a href={exportUrl} style={emailStyles.link}>
                    export everything
                </a>{" "}
                whenever you want.
            </Text>
        </EmailLayout>
    );
}
