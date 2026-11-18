import { type Dispatcher, getGlobalDispatcher } from "undici";

const transcriptionDispatcher = {
    dispatch(
        options: Dispatcher.DispatchOptions,
        handler: Dispatcher.DispatchHandler,
    ) {
        return getGlobalDispatcher().dispatch(
            { ...options, headersTimeout: 0, bodyTimeout: 0 },
            handler,
        );
    },
};

/** Apply a transcription deadline through response-body consumption. */
export function fetchTranscription(
    input: string | URL | Request,
    init: RequestInit,
    timeoutMs: number,
): Promise<Response> {
    const deadline = AbortSignal.timeout(timeoutMs);
    const callerSignal =
        init.signal ?? (input instanceof Request ? input.signal : undefined);
    const requestInit = {
        ...init,
        signal: callerSignal
            ? AbortSignal.any([callerSignal, deadline])
            : deadline,
        timeout: false,
        ...(!process.versions.bun
            ? { dispatcher: transcriptionDispatcher }
            : {}),
    };
    return fetch(input, requestInit);
}
