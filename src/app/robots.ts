import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

// `force-dynamic` so `env.IS_HOSTED` / `env.APP_URL` are read at request
// time, not bake time.
export const dynamic = "force-dynamic";

// Private surfaces excluded from the hosted crawl. These either require
// auth, redirect to login, or are non-content endpoints; keeping them out
// of the index avoids crawl budget waste and accidental exposure.
const HOSTED_DISALLOW = [
    "/api/",
    "/dashboard",
    "/settings",
    "/onboarding",
    "/recordings/",
    "/admin",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/suspended",
    "/dev/",
];

export default function robots(): MetadataRoute.Robots {
    // Self-host instances are private by default -- block all crawling and
    // advertise no sitemap. The hosted product (IS_HOSTED=true) is the only
    // surface meant to be indexed.
    if (!env.IS_HOSTED) {
        return {
            rules: [{ userAgent: "*", disallow: "/" }],
        };
    }

    const baseUrl = env.APP_URL ?? "https://mesynx-ai.com";

    return {
        rules: [{ userAgent: "*", allow: "/", disallow: HOSTED_DISALLOW }],
        sitemap: `${baseUrl}/sitemap.xml`,
        host: baseUrl,
    };
}
