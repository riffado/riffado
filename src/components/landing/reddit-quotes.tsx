const QUOTES = [
    {
        text: "The hardware is great, but the service is shit.",
        sub: "r/PlaudNoteUsers",
        href: "https://www.reddit.com/r/PlaudNoteUsers/comments/1iift1w/making_open_source_plaud_notepin_alternative_a/",
    },
    {
        text: "Sent it back after learning about a $30/month subscription. Immediately reminded me of a Black Mirror episode.",
        sub: "r/PlaudNoteUsers",
        href: "https://www.reddit.com/r/PlaudNoteUsers/comments/1k8yyht/subscription_too_expensive/",
    },
    {
        text: "It's really hard to justify paying that much just for convenience.",
        sub: "r/PlaudNoteUsers",
        href: "https://www.reddit.com/r/PlaudNoteUsers/comments/1k8yyht/subscription_too_expensive/",
    },
    {
        text: "I'm in the process of making a workaround to bypass their subscription.",
        sub: "r/PlaudNoteUsers",
        href: "https://www.reddit.com/r/PlaudNoteUsers/comments/1k8yyht/subscription_too_expensive/",
    },
];

export function RedditQuotes() {
    return (
        <section className="py-24 md:py-32">
            <div className="container mx-auto px-4">
                <div className="max-w-3xl mx-auto">
                    <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mb-6">
                        Real Plaud users, unedited
                    </p>
                    <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-16 text-muted-foreground">
                        We didn't make this up. It's why we built OpenPlaud.
                    </h2>
                    <ul className="space-y-12 md:space-y-16">
                        {QUOTES.map((q) => (
                            <li key={q.text}>
                                <blockquote className="text-2xl md:text-3xl lg:text-4xl font-medium tracking-tight leading-snug text-foreground">
                                    &ldquo;{q.text}&rdquo;
                                </blockquote>
                                <a
                                    href={q.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-block mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    from {q.sub}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </section>
    );
}
