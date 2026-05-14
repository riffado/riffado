import { Terminal } from "lucide-react";

export function Deploy() {
    return (
        <section
            id="deploy"
            className="py-24 bg-zinc-950 text-zinc-50 relative overflow-hidden"
        >
            <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5" />
            <div className="container mx-auto px-4 relative z-10">
                <div className="flex flex-col lg:flex-row items-center gap-12 max-w-6xl mx-auto">
                    <div className="lg:w-1/2 space-y-6">
                        <div className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-400">
                            <Terminal className="mr-2 size-3" />
                            Self-host, if you want to
                        </div>
                        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
                            Three commands. One container. Yours forever.
                        </h2>
                        <p className="text-zinc-400 text-lg leading-relaxed">
                            OpenPlaud ships as a single Docker Compose stack
                            with PostgreSQL and automatic migrations. Point it
                            at a domain, give it an AI key, and you're done. No
                            telemetry, no phone home, no license server.
                        </p>
                        <div className="flex flex-wrap gap-4 text-sm text-zinc-500">
                            <div className="flex items-center gap-2">
                                <div className="size-2 rounded-full bg-green-500" />
                                Docker
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="size-2 rounded-full bg-blue-500" />
                                Next.js 16
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="size-2 rounded-full bg-yellow-500" />
                                TypeScript
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="size-2 rounded-full bg-purple-500" />
                                AGPL-3.0
                            </div>
                        </div>
                    </div>
                    <div className="lg:w-1/2 w-full">
                        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 backdrop-blur overflow-hidden">
                            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900">
                                <div className="text-xs font-mono text-zinc-500">
                                    ~/openplaud
                                </div>
                            </div>
                            <div className="p-6 font-mono text-sm overflow-x-auto space-y-2">
                                <div>
                                    <span className="text-zinc-500">$ </span>
                                    <span className="text-purple-400">git</span>{" "}
                                    <span className="text-zinc-300">
                                        clone
                                        https://github.com/openplaud/openplaud.git
                                    </span>
                                </div>
                                <div>
                                    <span className="text-zinc-500">$ </span>
                                    <span className="text-purple-400">cd</span>{" "}
                                    <span className="text-zinc-300">
                                        openplaud
                                    </span>
                                </div>
                                <div>
                                    <span className="text-zinc-500">$ </span>
                                    <span className="text-blue-400">
                                        docker
                                    </span>{" "}
                                    <span className="text-zinc-300">
                                        compose up -d
                                    </span>
                                </div>
                                <div className="pt-3 text-green-400 leading-relaxed">
                                    ➜ Container openplaud-web-1 Started
                                    <br />➜ Container openplaud-db-1 Started
                                    <br />➜ App running at http://localhost:3000
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
