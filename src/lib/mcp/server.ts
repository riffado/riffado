import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
    getRecordingForUser,
    getSummaryForUser,
    getTranscriptForUser,
    listRecordingsForUser,
    SEARCH_WINDOW,
    searchRecordingsForUser,
} from "@/lib/mcp/tools";
import { APP_VERSION } from "@/lib/version";

const READ_ONLY = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
} as const;

const RECORDING_NOT_FOUND = "Recording not found";

const recordingIdInput = z.object({
    id: z.string().min(1).describe("Recording id"),
});

function jsonResult(value: Record<string, unknown>): CallToolResult {
    return {
        content: [{ type: "text", text: JSON.stringify(value) }],
        structuredContent: value,
    };
}

function textResult(text: string): CallToolResult {
    return { content: [{ type: "text", text }] };
}

function errorResult(message: string): CallToolResult {
    return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Builds a fresh read-only MCP server whose tools only ever read data owned by
 * `userId`. Create one per request; instances hold no cross-request state.
 */
export function createRiffadoMcpServer(userId: string): McpServer {
    const server = new McpServer({ name: "riffado", version: APP_VERSION });

    server.registerTool(
        "list_recordings",
        {
            title: "List recordings",
            description:
                "List the user's recordings, most recently updated first. Pass next_cursor from a previous result as cursor to get the next page.",
            inputSchema: z.object({
                limit: z.number().int().min(1).max(100).default(25),
                cursor: z.string().optional(),
            }),
            annotations: READ_ONLY,
        },
        async ({ limit, cursor }) => {
            const page = await listRecordingsForUser(userId, {
                limit,
                cursor,
            });
            return page ? jsonResult(page) : errorResult("Invalid cursor");
        },
    );

    server.registerTool(
        "get_recording",
        {
            title: "Get recording",
            description:
                "Get one recording by id, including its metadata, transcripts and summary.",
            inputSchema: recordingIdInput,
            annotations: READ_ONLY,
        },
        async ({ id }) => {
            const recording = await getRecordingForUser(userId, id);
            return recording
                ? jsonResult(recording)
                : errorResult(RECORDING_NOT_FOUND);
        },
    );

    server.registerTool(
        "get_transcript",
        {
            title: "Get transcript",
            description:
                "Get the primary transcript text of one recording by id.",
            inputSchema: recordingIdInput,
            annotations: READ_ONLY,
        },
        async ({ id }) => {
            const result = await getTranscriptForUser(userId, id);
            if (result.status === "recording_not_found") {
                return errorResult(RECORDING_NOT_FOUND);
            }
            if (result.status === "missing") {
                return errorResult("Transcript not found");
            }
            return jsonResult(result.value);
        },
    );

    server.registerTool(
        "get_summary",
        {
            title: "Get summary",
            description:
                "Get the AI summary, key points and action items of one recording by id.",
            inputSchema: recordingIdInput,
            annotations: READ_ONLY,
        },
        async ({ id }) => {
            const result = await getSummaryForUser(userId, id);
            if (result.status === "recording_not_found") {
                return errorResult(RECORDING_NOT_FOUND);
            }
            if (result.status === "missing") {
                return textResult("This recording has no summary yet.");
            }
            return jsonResult(result.value);
        },
    );

    server.registerTool(
        "search_recordings",
        {
            title: "Search recordings",
            description: `Find recordings whose title or transcript contains the query text (case-insensitive). Only the ${SEARCH_WINDOW} most recent recordings are searched; results are newest first.`,
            inputSchema: z.object({
                query: z.string().trim().min(1).max(200),
                limit: z.number().int().min(1).max(50).default(10),
            }),
            annotations: READ_ONLY,
        },
        async ({ query, limit }) => {
            const matches = await searchRecordingsForUser(userId, query, limit);
            return jsonResult({ data: matches });
        },
    );

    return server;
}
