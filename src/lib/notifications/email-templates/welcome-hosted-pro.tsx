import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { emailStyles } from "./styles";

interface Props {
    dashboardUrl: string;
    settingsUrl: string;
    /** True iff the user currently has active founding monthly pricing. */
    foundingMember: boolean;
    amountValue: string;
    amountCurrency: string;
    /** Billing interval of the subscription that triggered this email. */
    interval: "month" | "year";
}

export function WelcomeHostedProEmail({
    dashboardUrl,
    settingsUrl,
    foundingMember,
    amountValue,
    amountCurrency,
    interval,
}: Props) {
    return (
        <EmailLayout
            previewText="You're on Riffado Hosted Pro: 50 GB storage, 15 hours of Mynah transcription, unlimited devices."
            footerLink={{ href: settingsUrl, label: "Manage subscription" }}
        >
            <Heading style={emailStyles.h1}>You're on Hosted Pro.</Heading>
            <Text style={emailStyles.text}>
                Thanks for upgrading. Your subscription is active and your Pro
                entitlements are live:
            </Text>
            <Text style={emailStyles.text}>
                · 50 GB storage
                <br />· 15 hours of Mynah transcription, refreshed every 30 days
                <br />· Unlimited devices, background sync
            </Text>
            {foundingMember && interval === "month" ? (
                <Text style={emailStyles.text}>
                    You subscribed to the monthly plan during the
                    founding-member window, so your monthly price is locked at{" "}
                    {amountValue} {amountCurrency}/month for as long as your
                    subscription stays active. Thanks for being early.
                </Text>
            ) : null}
            <Section style={emailStyles.buttonSection}>
                <Button style={emailStyles.button} href={dashboardUrl}>
                    Open Riffado
                </Button>
            </Section>
        </EmailLayout>
    );
}
