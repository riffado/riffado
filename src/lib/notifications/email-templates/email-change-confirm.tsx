import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { emailStyles } from "./styles";

interface Props {
    confirmUrl: string;
    /** The new address the user is moving to. */
    newEmail: string;
    /** Token expiry in hours. */
    expiresInHours: number;
}

export function EmailChangeConfirmEmail({
    confirmUrl,
    newEmail,
    expiresInHours,
}: Props) {
    return (
        <EmailLayout previewText="Confirm the email change on your Riffado account.">
            <Heading style={emailStyles.h1}>Confirm email change.</Heading>
            <Text style={emailStyles.text}>
                A change request was made to update the email on your Riffado
                account to <strong>{newEmail}</strong>. Click below to confirm.
                The link expires in {expiresInHours}{" "}
                {expiresInHours === 1 ? "hour" : "hours"}.
            </Text>
            <Section style={emailStyles.buttonSection}>
                <Button style={emailStyles.button} href={confirmUrl}>
                    Confirm new email
                </Button>
            </Section>
            <Text style={emailStyles.text}>
                If you did not request this change, ignore this message and
                consider rotating your password.
            </Text>
        </EmailLayout>
    );
}
