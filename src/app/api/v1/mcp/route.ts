import { createMcpHandler } from "@modelcontextprotocol/server";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth-request";
import { apiHandler, ErrorCode } from "@/lib/errors";
import { createRiffadoMcpServer } from "@/lib/mcp/server";
import {
    enforceV1AuthenticatedRateLimit,
    enforceV1IpRateLimit,
} from "@/lib/v1/rate-limit";

function unauthorizedResponse(): NextResponse {
    return NextResponse.json(
        {
            error: "Unauthorized. Send a Riffado API key as a Bearer token.",
            code: ErrorCode.UNAUTHORIZED,
        },
        {
            status: 401,
            headers: { "WWW-Authenticate": 'Bearer realm="riffado"' },
        },
    );
}

function methodNotAllowed(): NextResponse {
    return NextResponse.json(
        { error: "Method not allowed", code: ErrorCode.INVALID_INPUT },
        { status: 405, headers: { Allow: "POST" } },
    );
}

export const POST = apiHandler(async (request: Request) => {
    const ipLimitResponse = await enforceV1IpRateLimit(request);
    if (ipLimitResponse) return ipLimitResponse;

    const authn = await authenticateRequest(request);
    if (!authn || authn.via !== "api-key") {
        return unauthorizedResponse();
    }

    const authLimitResponse = await enforceV1AuthenticatedRateLimit(authn);
    if (authLimitResponse) return authLimitResponse;

    const userId = authn.user.id;
    const handler = createMcpHandler(() => createRiffadoMcpServer(userId), {
        responseMode: "json",
    });
    return handler.fetch(request);
});

export function GET(): NextResponse {
    return methodNotAllowed();
}

export function DELETE(): NextResponse {
    return methodNotAllowed();
}
