import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { emailStyles } from "./styles";

interface Props {
    verificationUrl: string;
    /** Token expiry in hours (e.g. `24`). */
    expiresInHours: number;
}

export function VerifyEmailEmail({ verificationUrl, expiresInHours }: Props) {
    return (
        <EmailLayout previewText="Confirm your email address to finish setting up your Riffado account.">
            <Heading style={emailStyles.h1}>Confirm your email.</Heading>
            <Text style={emailStyles.text}>
                Click the button below to confirm this is your email address and
                finish setting up your Riffado account. The link expires in{" "}
                {expiresInHours} {expiresInHours === 1 ? "hour" : "hours"}.
            </Text>
            <Section style={emailStyles.buttonSection}>
                <Button style={emailStyles.button} href={verificationUrl}>
                    Confirm email
                </Button>
            </Section>
            <Text style={emailStyles.text}>
                If you didn't sign up for Riffado, you can safely ignore this
                message.
            </Text>
        </EmailLayout>
    );
}
