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

interface NewsletterConfirmEmailProps {
    confirmUrl: string;
}

export function NewsletterConfirmEmail({
    confirmUrl,
}: NewsletterConfirmEmailProps) {
    const previewText = "Confirm your Riffado newsletter subscription";

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
                    <Section style={emailStyles.header}>
                        <div style={{ textAlign: "center" }}>
                            <Img
                                src="https://riffado.com/logo.png"
                                alt="Riffado"
                                width="32"
                                height="32"
                                style={emailStyles.logo}
                            />
                        </div>
                    </Section>

                    <Section style={emailStyles.content}>
                        <Heading style={emailStyles.h1}>
                            Confirm your subscription
                        </Heading>
                        <Text style={emailStyles.text}>
                            You asked to receive Riffado product updates. Click
                            the button below to confirm. If you didn't sign up,
                            ignore this email -- without confirmation we'll
                            never email this address again.
                        </Text>

                        <Section
                            style={{ textAlign: "center", margin: "32px 0" }}
                        >
                            <Button
                                href={confirmUrl}
                                style={emailStyles.button}
                            >
                                Confirm subscription
                            </Button>
                        </Section>

                        <Text style={emailStyles.footerText}>
                            Or paste this link into your browser:
                        </Text>
                        <Text style={emailStyles.footerText}>
                            <a href={confirmUrl} style={emailStyles.link}>
                                {confirmUrl}
                            </a>
                        </Text>
                    </Section>
                </Container>
            </Body>
        </Html>
    );
}
