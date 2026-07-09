import { Heading, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { emailStyles } from "./styles";

interface Props {
    signupUrl: string;
}

export function AccountDeletedEmail({ signupUrl }: Props) {
    return (
        <EmailLayout previewText="Your Riffado account has been deleted.">
            <Heading style={emailStyles.h1}>Account deleted.</Heading>
            <Text style={emailStyles.text}>
                Your Riffado account, recordings, transcripts, and summaries
                have been permanently deleted. We don't keep backups of deleted
                user data, so this is irreversible.
            </Text>
            <Text style={emailStyles.text}>
                Thanks for trying Riffado. If you change your mind, you can
                always{" "}
                <a href={signupUrl} style={emailStyles.link}>
                    start fresh
                </a>{" "}
                or self-host the open-source version at{" "}
                <a
                    href="https://github.com/riffado/riffado"
                    style={emailStyles.link}
                >
                    github.com/riffado/riffado
                </a>
                .
            </Text>
        </EmailLayout>
    );
}
