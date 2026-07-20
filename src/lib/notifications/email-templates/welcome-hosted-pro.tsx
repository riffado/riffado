import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { formatEmailPrice } from "./format-price";
import { emailStyles } from "./styles";

interface Props {
    dashboardUrl: string;
    settingsUrl: string;
    /** True iff the user currently has active founding monthly pricing. */
    foundingMember: boolean;
    /**
     * 1-indexed founding-member rank (e.g. `47` of `foundingCapacity`).
     * Null when the user isn't a founding member, or the rank couldn't
     * be resolved -- the founding paragraph then falls back to the
     * cohort-only phrasing.
     */
    foundingRank: number | null;
    foundingCapacity: number;
    amountValue: string;
    amountCurrency: string;
    /** Billing interval of the subscription that triggered this email. */
    interval: "month" | "year";
    /** Recordings synced before this upgrade. 0 for a brand-new account. */
    recordingCount: number;
    totalDurationMs: number;
}

export function WelcomeHostedProEmail({
    dashboardUrl,
    settingsUrl,
    foundingMember,
    foundingRank,
    foundingCapacity,
    amountValue,
    amountCurrency,
    interval,
    recordingCount,
    totalDurationMs,
}: Props) {
    const hours = Math.round(totalDurationMs / 3_600_000);
    const isFoundingMonthly = foundingMember && interval === "month";
    return (
        <EmailLayout
            previewText="You're on Riffado Hosted Pro: 50 GB storage, 15 hours of Mynah transcription, unlimited devices."
            footerLink={{ href: settingsUrl, label: "Manage subscription" }}
        >
            <Heading style={emailStyles.h1}>You're on Hosted Pro.</Heading>
            {recordingCount > 0 ? (
                <Text style={emailStyles.text}>
                    Thanks for upgrading. You've already synced {recordingCount}{" "}
                    recording{recordingCount === 1 ? "" : "s"}
                    {hours > 0
                        ? ` (about ${hours} hour${hours === 1 ? "" : "s"} of audio)`
                        : ""}
                    . Sync and transcription keep running without interruption,
                    and your Pro entitlements are live:
                </Text>
            ) : (
                <Text style={emailStyles.text}>
                    Thanks for upgrading. Your subscription is active and your
                    Pro entitlements are live:
                </Text>
            )}
            <Text style={emailStyles.text}>50 GB storage</Text>
            <Text style={emailStyles.text}>
                15 hours of Mynah transcription, refreshed every 30 days
            </Text>
            <Text style={emailStyles.text}>
                Unlimited devices, background sync
            </Text>
            {isFoundingMonthly ? (
                <Text style={emailStyles.text}>
                    {foundingRank
                        ? `You're founding member #${foundingRank} of ${foundingCapacity}.`
                        : "You subscribed during the founding-member window."}{" "}
                    Your monthly price is locked at{" "}
                    {formatEmailPrice(amountValue, amountCurrency)} for as long
                    as your subscription stays active. Thanks for being early.
                </Text>
            ) : null}
            <Section style={emailStyles.buttonSection}>
                <Button style={emailStyles.button} href={dashboardUrl}>
                    Open Riffado
                </Button>
            </Section>
            <Text style={emailStyles.text}>
                "Email support" isn't a ticket queue here. Reply to this email
                if anything's off or you have a question. It reaches me
                directly.
                <br />
                Kacper, building Riffado
            </Text>
        </EmailLayout>
    );
}
