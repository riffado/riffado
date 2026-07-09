import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { formatEmailDate } from "./format-date";
import { emailStyles } from "./styles";

interface Props {
    /** Days remaining at send time. */
    daysLeft: number;
    /** When the account will be hard-deleted. */
    deletionAt: Date;
    exportUrl: string;
    reactivateUrl: string;
}

export function GraceReminderEmail({
    daysLeft,
    deletionAt,
    exportUrl,
    reactivateUrl,
}: Props) {
    return (
        <EmailLayout
            previewText={`${daysLeft} days left to export your Riffado data before the account is deleted.`}
            footerLink={{ href: reactivateUrl, label: "Reactivate account" }}
        >
            <Heading style={emailStyles.h1}>
                {daysLeft} days left to export.
            </Heading>
            <Text style={emailStyles.text}>
                A reminder: your Riffado account and every recording in it will
                be permanently deleted on {formatEmailDate(deletionAt)}. You
                have {daysLeft} days to export the data or reactivate.
            </Text>
            <Section style={emailStyles.buttonSection}>
                <Button style={emailStyles.button} href={exportUrl}>
                    Export my data
                </Button>
            </Section>
            <Text style={emailStyles.text}>
                Or{" "}
                <a href={reactivateUrl} style={emailStyles.link}>
                    add a card to reactivate
                </a>{" "}
                and pick up where you left off.
            </Text>
        </EmailLayout>
    );
}
