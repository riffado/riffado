import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { emailStyles } from "./styles";

interface TestEmailProps {
    dashboardUrl: string;
    settingsUrl: string;
}

export function TestEmail({ dashboardUrl, settingsUrl }: TestEmailProps) {
    return (
        <EmailLayout
            previewText="Test email from Riffado - Email notifications are working"
            footerLink={{ href: settingsUrl, label: "Manage notifications" }}
        >
            <Heading style={emailStyles.h1}>Test email</Heading>
            <Text style={emailStyles.text}>
                Your email notifications are configured correctly. You'll
                receive an email when new recordings are synced from your Plaud
                device.
            </Text>
            <Section style={emailStyles.buttonSection}>
                <Button style={emailStyles.button} href={dashboardUrl}>
                    Open dashboard
                </Button>
            </Section>
        </EmailLayout>
    );
}
