import { brandColors } from "./brand-colors";

export const emailStyles = {
    main: {
        backgroundColor: brandColors.background,
        fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        padding: "0",
        margin: "0",
        WebkitFontSmoothing: "antialiased",
        MozOsxFontSmoothing: "grayscale",
    },

    wrapper: {
        maxWidth: "600px",
        margin: "0 auto",
        padding: "0",
    },

    container: {
        backgroundColor: brandColors.white,
        margin: "0 auto",
        padding: "0",
        width: "100%",
        maxWidth: "600px",
    },

    header: {
        padding: "24px 20px",
        textAlign: "center" as const,
        borderBottom: `1px solid ${brandColors.borderDark}`,
    },

    brand: {
        color: brandColors.foreground,
        fontSize: "18px",
        fontWeight: "600",
        margin: "0",
        letterSpacing: "-0.02em",
        fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },

    logo: {
        display: "inline-block",
        width: "32px",
        height: "32px",
        margin: "0 auto",
        verticalAlign: "middle",
    },

    content: {
        padding: "32px 20px",
        backgroundColor: brandColors.white,
    },

    h1: {
        color: brandColors.foreground,
        fontSize: "24px",
        fontWeight: "600",
        margin: "0 0 12px 0",
        lineHeight: "1.3",
        letterSpacing: "-0.01em",
    },

    h2: {
        color: brandColors.foreground,
        fontSize: "20px",
        fontWeight: "600",
        margin: "0 0 16px 0",
        lineHeight: "1.4",
    },

    text: {
        color: brandColors.foreground,
        fontSize: "16px",
        lineHeight: "1.6",
        margin: "0 0 16px 0",
    },

    recordingList: {
        margin: "24px 0",
        padding: "0",
    },

    recordingItem: {
        display: "block",
        padding: "16px 0",
        borderBottom: `1px solid ${brandColors.borderLight}`,
        textDecoration: "none",
        color: brandColors.foreground,
    },

    recordingItemLast: {
        borderBottom: "none",
    },

    recordingName: {
        fontSize: "16px",
        fontWeight: "500",
        margin: "0 0 6px 0",
        lineHeight: "1.4",
        color: brandColors.foreground,
    },

    recordingMeta: {
        fontSize: "13px",
        color: brandColors.mutedForeground,
        fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        letterSpacing: "0.01em",
    },

    buttonSection: {
        margin: "32px 0",
        textAlign: "center" as const,
    },

    button: {
        display: "inline-block",
        backgroundColor: brandColors.primary,
        color: brandColors.white,
        fontSize: "16px",
        fontWeight: "500",
        textDecoration: "none",
        padding: "14px 32px",
        borderRadius: "6px",
        border: "none",
        lineHeight: "1.5",
        minWidth: "200px",
    },

    footer: {
        padding: "24px 20px",
        borderTop: `1px solid ${brandColors.borderLight}`,
        backgroundColor: brandColors.background,
        textAlign: "center" as const,
    },

    footerText: {
        color: brandColors.mutedForeground,
        fontSize: "13px",
        lineHeight: "1.5",
        margin: "0 0 8px 0",
    },

    link: {
        color: brandColors.primary,
        textDecoration: "underline",
    },

    statusDot: {
        display: "inline-block",
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        backgroundColor: brandColors.statusGreen,
        marginRight: "8px",
        verticalAlign: "middle",
    },

    divider: {
        height: "1px",
        backgroundColor: brandColors.borderLight,
        border: "none",
        margin: "24px 0",
    },

    /**
     * Bulletproof hanging-indent bullet, as a two-column table row
     * rather than CSS `text-indent`. Negative `text-indent` is
     * unreliable in desktop Outlook (Word rendering engine) -- a
     * wrapped second line can fall back to the left margin there and
     * read like a new, unrelated paragraph. A small table (`Row`/
     * `Column` from @react-email/components) is the standard bulletproof
     * pattern instead: the glyph gets its own narrow column, so wrapped
     * text in the text column stays aligned under itself in every
     * client, including Outlook. Pair with a local `<Bullet>` wrapper
     * component; don't reach for these two styles raw.
     */
    bulletGlyphColumn: {
        width: "18px",
        verticalAlign: "top" as const,
        color: brandColors.foreground,
        fontSize: "16px",
        lineHeight: "1.6",
    },
    bulletTextColumn: {
        color: brandColors.foreground,
        fontSize: "16px",
        lineHeight: "1.6",
    },

    /**
     * Mono uppercase section eyebrow, matching the site's landing-page
     * section markers ("PRICING", "FAQ"). Text only, no fill or border
     * -- pair with `divider` for section separation instead of a card.
     */
    eyebrow: {
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase" as const,
        fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        color: brandColors.mutedForeground,
        margin: "0 0 14px 0",
    },
};

export const mobileStyles = {
    content: {
        padding: "24px 16px",
    },
    h1: {
        fontSize: "22px",
    },
    h2: {
        fontSize: "18px",
    },
    text: {
        fontSize: "15px",
    },
    button: {
        display: "block",
        width: "100%",
        padding: "16px 24px",
    },
    header: {
        padding: "20px 16px",
    },
    footer: {
        padding: "20px 16px",
    },
};
