import { loader } from "fumadocs-core/source";
import { docs } from "@/.source/server";

// `baseUrl` must match the route group mount (`src/app/(docs)/docs`).
export const source = loader({
    baseUrl: "/docs",
    source: docs.toFumadocsSource(),
});
