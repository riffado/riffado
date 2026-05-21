import { NextResponse } from "next/server";
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
        return NextResponse.json(
            { error: "Invalid version tag. Expected vX.Y.Z." },
            { status: 404 },
        );
    }
    const script = await renderInstallScript(version);
    return new Response(script, { headers: INSTALL_SCRIPT_HEADERS });
}
