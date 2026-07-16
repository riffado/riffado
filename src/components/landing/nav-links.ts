import {
    Bot,
    BriefcaseBusiness,
    CreditCard,
    type LucideIcon,
    Plug,
    Server,
    SlidersHorizontal,
} from "lucide-react";

export type MarketingNavLink = {
    label: string;
    href: string;
    description: string;
    icon: LucideIcon;
};

export const productNavLinks: MarketingNavLink[] = [
    {
        label: "Features",
        href: "/#features",
        description: "Transcribe, summarize, search, and keep every recording.",
        icon: SlidersHorizontal,
    },
    {
        label: "Pricing",
        href: "/#pricing",
        description: "Choose hosted convenience or self-host for free.",
        icon: CreditCard,
    },
    {
        label: "Self-host",
        href: "/#deploy",
        description: "Run Riffado on infrastructure you control.",
        icon: Server,
    },
    {
        label: "For Professionals",
        href: "/for-professionals",
        description: "A private workflow for sensitive conversations.",
        icon: BriefcaseBusiness,
    },
];

export const docsNavLinks: MarketingNavLink[] = [
    {
        label: "Connect your recorder",
        href: "/docs/guides/connect-plaud-account",
        description: "Bring recordings into Riffado.",
        icon: Plug,
    },
    {
        label: "Choose your AI",
        href: "/docs/guides/ai-providers",
        description: "Use OpenAI, Anthropic, Groq, or a local model.",
        icon: Bot,
    },
];

export const resourceNavLinks = [
    { label: "Documentation", href: "/docs" },
    { label: "Changelog", href: "/changelog" },
    { label: "Product updates", href: "/updates" },
] as const;
