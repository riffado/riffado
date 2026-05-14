const FAQS = [
    {
        q: "Is this legal? Does using OpenPlaud void my Plaud warranty?",
        a: "OpenPlaud logs into your Plaud account with your credentials and downloads recordings through Plaud's existing API — the same way their own web app does. The hardware isn't modified. The official Plaud app keeps working alongside OpenPlaud. No warranty implications.",
    },
    {
        q: "What happens if Plaud changes their API?",
        a: "Worst case, sync breaks until we update. OpenPlaud is open-source and actively maintained — historically this has been a matter of hours to days. Your existing recordings stay yours regardless: they live on storage you control (or ours, on hosted) and never depend on Plaud's servers once synced.",
    },
    {
        q: "Which AI providers can I plug in?",
        a: "OpenAI, Anthropic, Groq, and anything that speaks an OpenAI-compatible API — OpenRouter, Together, Fireworks, LM Studio, Ollama, vLLM. You can also run Whisper or a local Llama model entirely on your own machine. Adding a new provider takes one config entry.",
    },
    {
        q: "Can I move from hosted to self-host later (or the other way)?",
        a: "Yes, in one click. The full-backup endpoint gives you a single archive with every recording, transcript, and summary. Restore it into a self-hosted instance, or back into our hosted version, with no loss. We designed this to be easy to leave precisely so you don't have to worry about choosing it.",
    },
    {
        q: "Where is my data stored on the hosted version?",
        a: "On encrypted, S3-compatible storage we run. You can export everything at any time. If you need a specific jurisdiction or your own bucket, self-hosting points the same code at infrastructure you control.",
    },
    {
        q: "What about HIPAA, privileged legal work, or regulated financial data?",
        a: "We don't self-attest HIPAA compliance. The meaningful privacy claim belongs to your AI provider, not to us. For regulated work, the right path is self-hosting OpenPlaud and plugging in a provider that signs a BAA you've reviewed (OpenAI Enterprise, Azure Speech, Deepgram), or using a local Whisper model that never leaves your machine. We'll give you the knobs; you own the compliance story.",
    },
];

export function FAQ() {
    return (
        <section className="py-24 md:py-32 border-t border-border/40">
            <div className="container mx-auto px-4">
                <div className="max-w-3xl mx-auto">
                    <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-12">
                        Questions people actually ask.
                    </h2>
                    <dl className="space-y-10">
                        {FAQS.map((item) => (
                            <div key={item.q}>
                                <dt className="text-lg font-semibold mb-3 leading-snug">
                                    {item.q}
                                </dt>
                                <dd className="text-muted-foreground leading-relaxed">
                                    {item.a}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </div>
            </div>
        </section>
    );
}
