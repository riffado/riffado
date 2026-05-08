import { NextResponse } from "next/server";
import {
    INSTALL_SCRIPT_HEADERS,
    isValidVersionTag,
    renderInstallScript,
} from "@/lib/install-script";

// Version-pinned installer entry point. Shape:
//   curl -fsSL https://openplaud.com/v0.2.0/install.sh | sh
//
// The `[version]` segment is a top-level dynamic route. We strictly
// validate the shape (`vX.Y.Z`) so this never shadows other top-level
// paths and so we never embed arbitrary user input into the rendered
// shell script.

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
