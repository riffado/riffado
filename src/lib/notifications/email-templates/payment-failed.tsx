import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { formatEmailDate } from "./format-date";
import { emailStyles } from "./styles";

interface Props {
    billingUrl: string;
    /** When Stripe next retries the charge (or 'shortly' if unknown). */
    nextRetryAt: Date | null;
    /** When the account will downgrade to Free if the issue isn't resolved. */
    accessUntil: Date | null;
}

function formatDate(d: Date | null): string {
    if (!d) return "shortly";
    return formatEmailDate(d, { month: "short" });
}

export function PaymentFailedEmail({
    billingUrl,
    nextRetryAt,
    accessUntil,
}: Props) {
    return (
        <EmailLayout
            previewText="Your Riffado Pro payment couldn't be processed. Update your payment method to keep Pro active."
            footerLink={{ href: billingUrl, label: "Update payment method" }}
        >
            <Heading style={emailStyles.h1}>Payment failed.</Heading>
            <Text style={emailStyles.text}>
                We couldn't process this cycle's charge for your Riffado Pro
                subscription. This usually means the card was declined or the
                bank flagged the transaction.
            </Text>
            <Text style={emailStyles.text}>
                Stripe will retry automatically{" "}
                {nextRetryAt ? `on ${formatDate(nextRetryAt)}` : "shortly"}.
                {accessUntil
                    ? ` Your Pro access continues until ${formatDate(
                          accessUntil,
                      )}; after that the account drops to Free.`
                    : " Your Pro access continues for now; if retries keep failing the account drops to Free."}
            </Text>
            <Section style={emailStyles.buttonSection}>
                <Button style={emailStyles.button} href={billingUrl}>
                    Update payment method
                </Button>
            </Section>
        </EmailLayout>
    );
}
