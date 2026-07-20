import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { emailStyles } from "./styles";

interface NewsletterConfirmEmailProps {
    confirmUrl: string;
}

export function NewsletterConfirmEmail({
    confirmUrl,
}: NewsletterConfirmEmailProps) {
    return (
        <EmailLayout previewText="Confirm your Riffado newsletter subscription">
            <Heading style={emailStyles.h1}>Confirm your subscription</Heading>
            <Text style={emailStyles.text}>
                You asked to receive Riffado product updates. Click the button
                below to confirm. If you didn't sign up, ignore this email --
                without confirmation we'll never email this address again.
            </Text>
            <Section style={emailStyles.buttonSection}>
                <Button href={confirmUrl} style={emailStyles.button}>
                    Confirm subscription
                </Button>
            </Section>
        </EmailLayout>
    );
}
