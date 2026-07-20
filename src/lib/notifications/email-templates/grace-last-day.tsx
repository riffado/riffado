import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { formatEmailDate } from "./format-date";
import { emailStyles } from "./styles";

interface Props {
    /** When the account will be hard-deleted (within the next ~24h). */
    deletionAt: Date;
    exportUrl: string;
    reactivateUrl: string;
}

export function GraceLastDayEmail({
    deletionAt,
    exportUrl,
    reactivateUrl,
}: Props) {
    return (
        <EmailLayout
            previewText="Last chance: your Riffado account is deleted in under 24 hours."
            footerLink={{ href: reactivateUrl, label: "Reactivate account" }}
        >
            <Heading style={emailStyles.h1}>Last chance to export.</Heading>
            <Text style={emailStyles.text}>
                Your Riffado account is scheduled for permanent deletion on{" "}
                {formatEmailDate(deletionAt, {
                    month: "short",
                    includeTime: true,
                })}
                . That's under 24 hours from now. Every recording, transcript,
                and summary will be removed and cannot be recovered.
            </Text>
            <Section style={emailStyles.buttonSection}>
                <Button style={emailStyles.button} href={exportUrl}>
                    Export now
                </Button>
            </Section>
            <Text style={emailStyles.text}>
                Want to keep your account?{" "}
                <a href={reactivateUrl} style={emailStyles.link}>
                    Add a card to reactivate
                </a>
                . Reactivation is instant, with no data loss.
            </Text>
        </EmailLayout>
    );
}
