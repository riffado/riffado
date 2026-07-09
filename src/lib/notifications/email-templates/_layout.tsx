import {
    Body,
    Container,
    Head,
    Html,
    Img,
    Link,
    Preview,
    Section,
    Text,
} from "@react-email/components";
import type React from "react";
import { emailStyles } from "./styles";

interface EmailLayoutProps {
    /** First-line snippet shown in inbox list previews. */
    previewText: string;
    /** Optional small footer link below the main copy. */
    footerLink?: { href: string; label: string };
    /** Body content. */
    children: React.ReactNode;
}

/**
 * Shared chrome for all Riffado-sent emails. Wraps the body in the
 * brand container, includes the inbox preview text, viewport/color-scheme
 * meta tags, and the minimal logo + footer.
 */
export function EmailLayout({
    previewText,
    footerLink,
    children,
}: EmailLayoutProps) {
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

                    <Section style={emailStyles.content}>{children}</Section>

                    <Section style={emailStyles.footer}>
                        {footerLink ? (
                            <Text style={emailStyles.footerText}>
                                <Link
                                    href={footerLink.href}
                                    style={emailStyles.link}
                                >
                                    {footerLink.label}
                                </Link>
                            </Text>
                        ) : null}
                        <Text style={emailStyles.footerText}>
                            Riffado. Your recordings, your transcripts.
                        </Text>
                    </Section>
                </Container>
            </Body>
        </Html>
    );
}
