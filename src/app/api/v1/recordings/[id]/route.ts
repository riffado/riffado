import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth-request";
import { getV1RecordingDetailForUser } from "@/lib/v1/serialize";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const authn = await authenticateRequest(request);
        if (!authn) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const { id } = await params;
        const recording = await getV1RecordingDetailForUser(authn.user.id, id);

        if (!recording) {
            return NextResponse.json(
                { error: "Recording not found" },
                { status: 404 },
            );
        }

        return NextResponse.json(recording);
    } catch (error) {
        console.error("Error fetching v1 recording:", error);
        return NextResponse.json(
            { error: "Failed to fetch recording" },
            { status: 500 },
        );
    }
}
