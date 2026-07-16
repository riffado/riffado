import { readFileSync } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import { ImageResponse } from "next/og";
import { isOgCardSlug, OG_CARDS } from "@/lib/seo/og-cards";

export const runtime = "nodejs";

// Only the slugs in the registry are rendered; everything else 404s.
export const dynamic = "force-static";
export const dynamicParams = false;

const ASSET_DIR = join(process.cwd(), "public", "og-assets");
const readAsset = (name: string) => readFileSync(join(ASSET_DIR, name));

// Inter (SIL OFL) stands in for the design's SF Pro, which is not
// redistributable in a public repo.
const inter = readAsset("Inter-SemiBold.ttf");
const wordmark = `data:image/png;base64,${readAsset("wordmark.png").toString("base64")}`;
const dotGrid = `data:image/png;base64,${readAsset("dot-grid.png").toString("base64")}`;

// Matches globals.css `--primary` / `--primary-foreground`.
const BG = "#c96442";
const FG = "#f2f0ef";

export function generateStaticParams() {
    return Object.keys(OG_CARDS).map((slug) => ({ slug }));
}

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ slug: string }> },
) {
    const { slug } = await params;
    if (!isOgCardSlug(slug)) notFound();

    return new ImageResponse(
        <div
            style={{
                width: "100%",
                height: "100%",
                position: "relative",
                display: "flex",
                overflow: "hidden",
                background: BG,
                fontFamily: "Inter",
            }}
        >
            {/* biome-ignore lint/performance/noImgElement: next/og (Satori) renders raw <img>, not next/image. */}
            <img
                src={dotGrid}
                width={480}
                height={478}
                alt=""
                style={{ position: "absolute", top: -14, left: 956 }}
            />
            {/* biome-ignore lint/performance/noImgElement: next/og (Satori) renders raw <img>, not next/image. */}
            <img
                src={wordmark}
                width={232}
                height={44}
                alt=""
                style={{ position: "absolute", top: 60, left: 484 }}
            />
            <div
                style={{
                    position: "absolute",
                    left: 60,
                    top: 264,
                    width: 819,
                    display: "flex",
                    color: FG,
                    fontSize: 100,
                    fontWeight: 600,
                    lineHeight: 1,
                    letterSpacing: "-0.02em",
                }}
            >
                {OG_CARDS[slug]}
            </div>
        </div>,
        {
            width: 1200,
            height: 630,
            fonts: [
                { name: "Inter", data: inter, weight: 600, style: "normal" },
            ],
        },
    );
}
