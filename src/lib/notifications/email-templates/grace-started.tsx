import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { formatEmailDate } from "./format-date";
import { emailStyles } from "./styles";

interface Props {
    /** Which lapse path the user is on -- gates the copy. */
    gracePath: "trial" | "paid";
    /** Total grace window in days (7 for trial, 30 for paid). */
    graceDays: number;
    /** Configured trial length in days (`BILLING_TRIAL_DAYS`, default 14). Only used when `gracePath === "trial"`. */
    trialDays: number;
    /** When the account will be hard-deleted. */
    deletionAt: Date;
    exportUrl: string;
    reactivateUrl: string;
}

export function GraceStartedEmail({
    gracePath,
    graceDays,
    trialDays,
    deletionAt,
    exportUrl,
    reactivateUrl,
}: Props) {
    const heading =
        gracePath === "trial"
            ? "Your trial ended."
            : "Your subscription ended.";
    const lead =
        gracePath === "trial"
            ? `Your ${trialDays}-day Riffado Pro trial ended without a card on file. You have ${graceDays} days to export your data; after that, your account and all recordings will be permanently deleted on ${formatEmailDate(deletionAt)}.`
            : `Your Riffado Pro subscription ended. You have ${graceDays} days to export your data or reactivate. After ${formatEmailDate(deletionAt)} your account and all recordings will be permanently deleted.`;
    return (
        <EmailLayout
            previewText={`You have ${graceDays} days to export your Riffado data before the account is deleted.`}
            footerLink={{ href: reactivateUrl, label: "Reactivate account" }}
        >
            <Heading style={emailStyles.h1}>{heading}</Heading>
            <Text style={emailStyles.text}>{lead}</Text>
            <Text style={emailStyles.text}>
                Until then, your recordings are still playable and your data is
                fully exportable. Sync from your device and new transcriptions
                are paused.
            </Text>
            <Section style={emailStyles.buttonSection}>
                <Button style={emailStyles.button} href={exportUrl}>
                    Export my data
                </Button>
            </Section>
            <Text style={emailStyles.text}>
                Changed your mind?{" "}
                <a href={reactivateUrl} style={emailStyles.link}>
                    Add a card to reactivate
                </a>{" "}
                — everything resumes instantly, nothing is lost.
            </Text>
        </EmailLayout>
    );
}
