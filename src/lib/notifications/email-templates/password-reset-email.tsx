import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { emailStyles } from "./styles";

interface PasswordResetEmailProps {
    resetUrl: string;
}

export function PasswordResetEmail({ resetUrl }: PasswordResetEmailProps) {
    return (
        <EmailLayout previewText="Reset your Riffado password">
            <Heading style={emailStyles.h1}>Reset your password</Heading>
            <Text style={emailStyles.text}>
                We received a request to reset the password for your Riffado
                account. Click the button below to choose a new password. This
                link expires in 1 hour.
            </Text>
            <Section style={emailStyles.buttonSection}>
                <Button style={emailStyles.button} href={resetUrl}>
                    Reset password
                </Button>
            </Section>
            <Text style={emailStyles.text}>
                If the button doesn't work, paste this URL into your browser:
            </Text>
            <Text
                style={{
                    ...emailStyles.text,
                    wordBreak: "break-all",
                    fontSize: "13px",
                }}
            >
                {resetUrl}
            </Text>
            <Text style={emailStyles.text}>
                If you didn't request a password reset, you can safely ignore
                this email -- your password will not change.
            </Text>
        </EmailLayout>
    );
}
