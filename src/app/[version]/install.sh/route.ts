import { NextResponse } from "next/server";
import { recordInstallHit } from "@/lib/admin/install-hits";
import {
    INSTALL_SCRIPT_HEADERS,
    isValidVersionTag,
    renderInstallScript,
} from "@/lib/install-script";

export const runtime = "nodejs";

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ version: string }> },
) {
    const { version } = await params;
    if (!isValidVersionTag(version)) {
        // Record the attempt so we can see if junk paths are getting
        // hammered. Force the "invalid" bucket explicitly -- the raw
        // segment might match a special bucket name (e.g. "latest")
        // and falsely inflate that bucket even though we 404'd here.
        await recordInstallHit("invalid");
        return NextResponse.json(
            { error: "Invalid version tag. Expected vX.Y.Z." },
            { status: 404 },
        );
    }
    const script = await renderInstallScript(version);
    await recordInstallHit(version);
    return new Response(script, { headers: INSTALL_SCRIPT_HEADERS });
}
