import {
    Body,
    Button,
    Container,
    Head,
    Heading,
    Html,
    Img,
    Link,
    Preview,
    Section,
    Text,
} from "@react-email/components";
import { emailStyles } from "./styles";

interface TestEmailProps {
    dashboardUrl: string;
    settingsUrl: string;
}

export function TestEmail({ dashboardUrl, settingsUrl }: TestEmailProps) {
    const previewText =
        "Test email from Mesynx AI - Email notifications are working";

    return (
        <Html>
            <Head>
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1.0"
                />
                <meta name="color-scheme" content="light" />
                <meta name="supported-color-schemes" content="light" />
            </Head>
            <Preview>{previewText}</Preview>
            <Body style={emailStyles.main}>
                <Container style={emailStyles.container}>
                    {/* Minimal header */}
                    <Section style={emailStyles.header}>
                        <div style={{ textAlign: "center" }}>
                            <Img
                                src="https://mesynx-ai.com/logo.png"
                                alt="Mesynx AI"
                                width="32"
                                height="32"
                                style={emailStyles.logo}
                            />
                        </div>
                    </Section>

                    {/* Content */}
                    <Section style={emailStyles.content}>
                        <Heading style={emailStyles.h1}>Test email</Heading>

                        <Text style={emailStyles.text}>
                            Your email notifications are configured correctly.
                            You'll receive an email when new recordings are
                            synced from your Plaud device.
                        </Text>

                        <Section style={emailStyles.buttonSection}>
                            <Button
                                style={emailStyles.button}
                                href={dashboardUrl}
                            >
                                Open dashboard
                            </Button>
                        </Section>
                    </Section>

                    {/* Minimal footer */}
                    <Section style={emailStyles.footer}>
                        <Text style={emailStyles.footerText}>
                            <Link href={settingsUrl} style={emailStyles.link}>
                                Manage notifications
                            </Link>
                        </Text>
                    </Section>
                </Container>
            </Body>
        </Html>
    );
}
