import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { formatEmailDate } from "./format-date";
import { formatEmailPrice } from "./format-price";
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

// Sent ~3 days before the free Pro window closes. States the fork plainly:
// subscribe, self-host, or go read-only. Founding pricing is only shown while
// DB-backed capacity remains. Grandfathered data is never deleted.
export function TransitionReminderEmail({
    daysLeft,
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
            previewText={`${daysLeft} day${daysLeft === 1 ? "" : "s"} of free Hosted Pro left. Choose a plan to keep sync and transcription.`}
            footerLink={{ href: billingUrl, label: "Manage billing" }}
        >
            <Heading style={emailStyles.h1}>
                {daysLeft} day{daysLeft === 1 ? "" : "s"} of free Hosted Pro
                left.
            </Heading>
            <Text style={emailStyles.text}>
                Your free hosted window closes on{" "}
                <strong>{formatEmailDate(transitionEndsAt)}</strong>. To keep
                background sync, new transcriptions, and uploads running, choose
                a plan before then.
            </Text>
            {foundingOfferAvailable ? (
                <Text style={emailStyles.text}>
                    Founding monthly spots are still available to the first{" "}
                    {foundingCapacity} paid monthly members at{" "}
                    {formatEmailPrice(amountValue, amountCurrency)}. Once
                    claimed, that price stays locked while the subscription
                    remains active.
                </Text>
            ) : (
                <Text style={emailStyles.text}>
                    Monthly Hosted Pro is currently{" "}
                    {formatEmailPrice(amountValue, amountCurrency)}.
                </Text>
            )}
            <Section style={emailStyles.buttonSection}>
                <Button style={emailStyles.button} href={billingUrl}>
                    {foundingOfferAvailable
                        ? `Lock in ${formatEmailPrice(amountValue, amountCurrency)}`
                        : "Subscribe"}
                </Button>
            </Section>
            <Text style={emailStyles.text}>
                If you'd rather not subscribe, that's fine. Nothing gets
                deleted. After {formatEmailDate(transitionEndsAt)} your account
                goes read-only: your recordings stay playable and exportable,
                but sync and new transcriptions pause until you subscribe. You
                can{" "}
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
