import {
    Body,
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

interface RebrandAnnouncementEmailProps {
    recipientName: string | null;
    rebrandUrl: string;
    loginUrl: string;
    unsubscribeUrl: string;
}

export function RebrandAnnouncementEmail({
    recipientName,
    rebrandUrl,
    loginUrl,
    unsubscribeUrl,
}: RebrandAnnouncementEmailProps) {
    const previewText =
        "OpenPlaud is now Riffado. Same code, same team, new name.";
    const opener = recipientName ? `Hey ${recipientName},` : "Hey,";

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
                            OpenPlaud is now Riffado.
                        </Heading>

                        <Text style={emailStyles.text}>{opener}</Text>

                        <Text style={emailStyles.text}>
                            Quick note: the project you signed up for as
                            OpenPlaud is now called Riffado. Same code, same
                            team, same AGPL license. We changed the name because
                            the roadmap is broader than one recorder, and the
                            old name kept boxing us in. That's it.
                        </Text>

                        <Text style={emailStyles.text}>
                            Nothing about your account changes. Your recordings,
                            transcripts, summaries, and settings are exactly
                            where you left them. Same prices, same free tier,
                            same self-host install. Your API tokens (the ones
                            starting with{" "}
                            <span
                                style={{
                                    fontFamily:
                                        "ui-monospace, SFMono-Regular, Menlo, monospace",
                                }}
                            >
                                op_
                            </span>
                            ) keep working &mdash; nothing to rotate in n8n,
                            Zapier, or any of your scripts.
                        </Text>

                        <Text style={emailStyles.text}>
                            The main practical change: the URL is{" "}
                            <Link href={loginUrl} style={emailStyles.link}>
                                riffado.com
                            </Link>{" "}
                            now. The old domain redirects automatically, but
                            update your bookmarks when you get a chance.
                        </Text>

                        <Text style={emailStyles.text}>
                            Full story (not a buyout, not an acquisition, not a
                            fork) and the details for self-hosters live at{" "}
                            <Link href={rebrandUrl} style={emailStyles.link}>
                                riffado.com/rebrand
                            </Link>
                            .
                        </Text>

                        <Text style={emailStyles.text}>
                            If anything broke for you, hit reply &mdash; I read
                            this inbox.
                        </Text>

                        <Text style={emailStyles.text}>
                            &mdash; Kacper, from Riffado
                        </Text>
                    </Section>

                    <Section style={emailStyles.footer}>
                        <Text style={emailStyles.footerText}>
                            You're receiving this because you have a Riffado
                            (formerly OpenPlaud) account. This is a one-time
                            announcement about the rebrand.
                        </Text>
                        <Text style={emailStyles.footerText}>
                            <Link
                                href={unsubscribeUrl}
                                style={emailStyles.link}
                            >
                                Unsubscribe from product updates
                            </Link>{" "}
                            (you'll still receive transactional email &mdash;
                            password resets, sync notifications, etc.)
                        </Text>
                    </Section>
                </Container>
            </Body>
        </Html>
    );
}
