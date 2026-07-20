import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { emailStyles } from "./styles";

interface Props {
    downloadUrl: string;
}

export function ExportReadyEmail({ downloadUrl }: Props) {
    return (
        <EmailLayout
            previewText="Your Riffado data export is ready to download."
            footerLink={{ href: downloadUrl, label: "Download export" }}
        >
            <Heading style={emailStyles.h1}>Your export is ready</Heading>
            <Text style={emailStyles.text}>
                We finished building your full data archive: every
                recording&apos;s audio, transcript, and AI summary, zipped up
                and ready to download.
            </Text>
            <Section style={emailStyles.buttonSection}>
                <Button style={emailStyles.button} href={downloadUrl}>
                    Download export
                </Button>
            </Section>
            <Text style={emailStyles.text}>
                The download link stays active for 7 days.
            </Text>
        </EmailLayout>
    );
}
