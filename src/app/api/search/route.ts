import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

// Static FlexSearch index built from the docs source. The index is generated
// at build time and served as a static JSON payload \u2014 no per-request work,
// no DB hit, safe to cache aggressively. Lives under `/api/search` because
// Fumadocs' default client search hook (`useDocsSearch`) defaults to that
// path; override there if the path ever needs to move.
export const { GET } = createFromSource(source);
