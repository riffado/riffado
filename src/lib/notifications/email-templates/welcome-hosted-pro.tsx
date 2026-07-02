import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { emailStyles } from "./styles";

interface Props {
    dashboardUrl: string;
    settingsUrl: string;
    /** True iff the user signed up within the founding-member window. */
    foundingMember: boolean;
    amountValue: string;
    amountCurrency: string;
}

export function WelcomeHostedProEmail({
    dashboardUrl,
    settingsUrl,
    foundingMember,
    amountValue,
    amountCurrency,
}: Props) {
    return (
        <EmailLayout
            previewText="You're on Riffado Hosted Pro — 50 GB storage, 15 hours of Mynah transcription, unlimited devices."
            footerLink={{ href: settingsUrl, label: "Manage subscription" }}
        >
            <Heading style={emailStyles.h1}>You're on Hosted Pro.</Heading>
            <Text style={emailStyles.text}>
                Thanks for upgrading. Your subscription is active and your Pro
                entitlements are live:
            </Text>
            <Text style={emailStyles.text}>
                · 50 GB storage
                <br />· 15 hours of Mynah transcription this cycle, refreshed
                monthly
                <br />· Unlimited devices, background sync
            </Text>
            {foundingMember ? (
                <Text style={emailStyles.text}>
                    You signed up during the founding-member window, so your
                    price is locked at {amountValue} {amountCurrency}/month for
                    as long as your subscription stays active. Thanks for being
                    early.
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
