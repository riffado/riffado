import {
    Body,
    Button,
    Container,
    Head,
    Heading,
    Html,
    Img,
    Preview,
    Section,
    Text,
} from "@react-email/components";
import { emailStyles } from "./styles";

interface PasswordResetEmailProps {
    resetUrl: string;
}

export function PasswordResetEmail({ resetUrl }: PasswordResetEmailProps) {
    const previewText = "Reset your OpenPlaud password";

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
                                src="https://openplaud.com/logo.png"
                                alt="OpenPlaud"
                                width="32"
                                height="32"
                                style={emailStyles.logo}
                            />
                        </div>
                    </Section>

                    {/* Content */}
                    <Section style={emailStyles.content}>
                        <Heading style={emailStyles.h1}>
                            Reset your password
                        </Heading>

                        <Text style={emailStyles.text}>
                            We received a request to reset the password for your
                            OpenPlaud account. Click the button below to choose
                            a new password. This link expires in 1 hour.
                        </Text>

                        <Section style={emailStyles.buttonSection}>
                            <Button style={emailStyles.button} href={resetUrl}>
                                Reset password
                            </Button>
                        </Section>

                        <Text style={emailStyles.text}>
                            If the button doesn't work, paste this URL into your
                            browser:
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
                    </Section>

                    {/* Minimal footer */}
                    <Section style={emailStyles.footer}>
                        <Text style={emailStyles.footerText}>
                            If you didn't request a password reset, you can
                            safely ignore this email -- your password will not
                            change.
                        </Text>
                    </Section>
                </Container>
            </Body>
        </Html>
    );
}
