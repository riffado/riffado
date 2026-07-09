import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { emailStyles } from "./styles";

interface Props {
    billingUrl: string;
    settingsUrl: string;
    /** Current storage usage in bytes. */
    currentBytes: number;
    /** Free-tier storage cap in bytes. */
    limitBytes: number;
}

function formatGB(bytes: number): string {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function OverCapEmail({
    billingUrl,
    settingsUrl,
    currentBytes,
    limitBytes,
}: Props) {
    return (
        <EmailLayout
            previewText="Your Riffado account is over the Free storage limit. Sync of new objects is paused until you upgrade or free up space."
            footerLink={{ href: settingsUrl, label: "Open settings" }}
        >
            <Heading style={emailStyles.h1}>You're over the Free cap.</Heading>
            <Text style={emailStyles.text}>
                Your account is using {formatGB(currentBytes)} of the{" "}
                {formatGB(limitBytes)} Free-tier storage cap.
            </Text>
            <Text style={emailStyles.text}>
                Your data is safe and your existing recordings still play. We've
                paused sync of <em>new</em> objects from Plaud until you either
                upgrade to Pro (50 GB cap) or delete enough recordings to come
                back under the limit.
            </Text>
            <Section style={emailStyles.buttonSection}>
                <Button style={emailStyles.button} href={billingUrl}>
                    Upgrade to Pro
                </Button>
            </Section>
        </EmailLayout>
    );
}
