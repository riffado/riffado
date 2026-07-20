import { Heading, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
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
    const opener = recipientName ? `Hey ${recipientName},` : "Hey,";

    return (
        <EmailLayout
            previewText="OpenPlaud is now Riffado. Same code, same team, new name."
            footerLink={{
                href: unsubscribeUrl,
                label: "Unsubscribe from product updates",
            }}
        >
            <Heading style={emailStyles.h1}>OpenPlaud is now Riffado.</Heading>

            <Text style={emailStyles.text}>{opener}</Text>

            <Text style={emailStyles.text}>
                Quick note: the project you signed up for as OpenPlaud is now
                called Riffado. Same code, same team, same AGPL license. We
                changed the name because the roadmap is broader than one
                recorder, and the old name kept boxing us in. That's it.
            </Text>

            <Text style={emailStyles.text}>
                Nothing about your account changes. Your recordings,
                transcripts, summaries, and settings are exactly where you left
                them. Same prices, same free tier, same self-host install. Your
                API tokens (the ones starting with{" "}
                <span
                    style={{
                        fontFamily:
                            "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                >
                    op_
                </span>
                ) keep working -- nothing to rotate in n8n, Zapier, or any of
                your scripts.
            </Text>

            <Text style={emailStyles.text}>
                The main practical change: the URL is{" "}
                <a href={loginUrl} style={emailStyles.link}>
                    riffado.com
                </a>{" "}
                now. The old domain redirects automatically, but update your
                bookmarks when you get a chance.
            </Text>

            <Text style={emailStyles.text}>
                Full story (not a buyout, not an acquisition, not a fork) and
                the details for self-hosters live at{" "}
                <a href={rebrandUrl} style={emailStyles.link}>
                    riffado.com/rebrand
                </a>
                .
            </Text>

            <Text style={emailStyles.text}>
                If anything broke for you, hit reply. I read this inbox.
                <br />
                Kacper, from Riffado
            </Text>

            <Text style={emailStyles.text}>
                You're receiving this because you have a Riffado (formerly
                OpenPlaud) account. This is a one-time announcement about the
                rebrand. You'll still receive transactional email: password
                resets, sync notifications, and the like.
            </Text>
        </EmailLayout>
    );
}
