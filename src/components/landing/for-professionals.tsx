import { FileLock, GitBranch, Server } from "lucide-react";

export function ForProfessionals() {
    return (
        <section className="py-24 bg-secondary/20 border-y border-border/40">
            <div className="container mx-auto px-4">
                <div className="max-w-3xl mx-auto">
                    <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mb-4">
                        For professionals
                    </p>
                    <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-6">
                        If your conversations stay in the room, your recordings
                        should too.
                    </h2>
                    <p className="text-muted-foreground text-lg leading-relaxed mb-12">
                        Lawyers, journalists, consultants, researchers:
                        OpenPlaud gives you the parts that matter. Your
                        recordings on infrastructure you control, the ability to
                        audit every line of code yourself, and a real choice of
                        AI provider, including ones that never leave your
                        machine.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                        <ProBeat
                            icon={<Server className="size-5" />}
                            title="Infrastructure you control"
                            description="Local disk, your own S3 bucket, or our hosted tier. No data sits somewhere you can't reach."
                        />
                        <ProBeat
                            icon={<GitBranch className="size-5" />}
                            title="Auditable by design"
                            description="Every line of OpenPlaud is AGPL-3.0. Read it, fork it, prove to your clients what it does."
                        />
                        <ProBeat
                            icon={<FileLock className="size-5" />}
                            title="Your choice of AI provider"
                            description="OpenAI, Anthropic, Groq, or a Whisper/Llama model running entirely on your own hardware via Ollama."
                        />
                    </div>

                    <div className="rounded-xl border border-border bg-card p-6 md:p-8">
                        <h3 className="text-base font-semibold mb-3">
                            About HIPAA and regulated work
                        </h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            Plaud self-attests HIPAA compliance and will sign a
                            BAA. OpenPlaud doesn't make a compliance claim of
                            its own; the claim belongs to your AI provider, not
                            to us. If you handle protected information (health,
                            privileged legal, regulated financial), the right
                            path is to self-host OpenPlaud with a provider that
                            signs a BAA you've reviewed (OpenAI Enterprise,
                            Azure Speech, Deepgram), or use a local Whisper
                            model that never leaves your machine. We won't
                            promise compliance we don't control. We'll give you
                            the tools to achieve it yourself.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
}

function ProBeat({
    icon,
    title,
    description,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
}) {
    return (
        <div className="space-y-3">
            <div className="size-10 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
                {icon}
            </div>
            <h3 className="text-base font-semibold leading-tight">{title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
                {description}
            </p>
        </div>
    );
}
