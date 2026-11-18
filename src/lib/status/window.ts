import { listStatusBuckets } from "@/db/queries/status";
import {
    STATUS_WINDOW_S,
    type StatusPart,
    sumCounts,
    type WindowCounts,
} from "./types";

const MINUTE_MS = 60_000;

/**
 * Sum the last `minutes` minute buckets (the current one included) ending
 * at `now` across every process. Throws when Postgres can't be read; the
 * caller turns that into "metrics-unavailable".
 */
export async function readWindow(
    part: StatusPart,
    now: Date = new Date(),
    minutes: number = Math.ceil(STATUS_WINDOW_S / 60),
): Promise<WindowCounts> {
    const currentMinute = Math.floor(now.getTime() / MINUTE_MS);
    const since = new Date((currentMinute - minutes + 1) * MINUTE_MS);
    const rows = await listStatusBuckets(part, since);
    return sumCounts(
        rows.map((row) => ({
            ok: row.ok,
            err: row.err,
            buckets: row.latencyBuckets,
        })),
    );
}
