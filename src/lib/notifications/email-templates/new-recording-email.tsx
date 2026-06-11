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

interface NewRecordingEmailProps {
    count: number;
    recordingNames?: string[];
    dashboardUrl: string;
    settingsUrl: string;
}

const EMPTY_NAMES: string[] = [];

export function NewRecordingEmail({
    count,
    recordingNames = EMPTY_NAMES,
    dashboardUrl,
    settingsUrl,
}: NewRecordingEmailProps) {
    const previewText =
        count === 1 ? "New recording synced" : `${count} new recordings synced`;

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
                                src="https://riffado.com/logo.png"
                                alt="Riffado"
                                width="32"
                                height="32"
                                style={emailStyles.logo}
                            />
                        </div>
                    </Section>

                    {/* Content */}
                    <Section style={emailStyles.content}>
                        <Heading style={emailStyles.h1}>
                            {count === 1
                                ? "New recording synced"
                                : `${count} new recordings synced`}
                        </Heading>

                        {recordingNames.length > 0 ? (
                            <>
                                <Text style={emailStyles.text}>
                                    Your Plaud device has synced the following
                                    {count === 1 ? " recording" : " recordings"}
                                    :
                                </Text>

                                <Section style={emailStyles.recordingList}>
                                    {recordingNames
                                        .slice(0, 10)
                                        .map((name, index) => (
                                            <Link
                                                key={name}
                                                href={dashboardUrl}
                                                style={{
                                                    ...emailStyles.recordingItem,
                                                    ...(index ===
                                                    Math.min(
                                                        recordingNames.length,
                                                        10,
                                                    ) -
                                                        1
                                                        ? emailStyles.recordingItemLast
                                                        : {}),
                                                }}
                                            >
                                                <Text
                                                    style={
                                                        emailStyles.recordingName
                                                    }
                                                >
                                                    {name}
                                                </Text>
                                            </Link>
                                        ))}
                                    {recordingNames.length > 10 && (
                                        <Text
                                            style={{
                                                ...emailStyles.recordingMeta,
                                                marginTop: "8px",
                                            }}
                                        >
                                            +{recordingNames.length - 10} more
                                        </Text>
                                    )}
                                </Section>
                            </>
                        ) : (
                            <Text style={emailStyles.text}>
                                Your Plaud device has synced{" "}
                                {count === 1
                                    ? "a new recording"
                                    : `${count} new recordings`}{" "}
                                to your dashboard.
                            </Text>
                        )}

                        <Section style={emailStyles.buttonSection}>
                            <Button
                                style={emailStyles.button}
                                href={dashboardUrl}
                            >
                                View recordings
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
