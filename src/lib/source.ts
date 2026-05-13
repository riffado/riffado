import { loader } from "fumadocs-core/source";
import { docs } from "@/.source/server";

// Single Fumadocs source instance used by docs pages and the search route.
// `baseUrl` matches the route group mount point (`src/app/(docs)/docs`).
// Keep these two in lockstep \u2014 a mismatch silently breaks sidebar links.
export const source = loader({
    baseUrl: "/docs",
    source: docs.toFumadocsSource(),
});
