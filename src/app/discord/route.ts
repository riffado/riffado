import { permanentRedirect } from "next/navigation";

// Public shortcut for the Mesynx AI community Discord. Lives in the repo
// (not Cloudflare) so the invite URL is version-controlled and visible in
// `git log` / grep, matching the `install.sh` precedent for user-facing
// URLs on mesynx-ai.com. If the invite ever needs to rotate, change the
// string here and ship a commit.
const DISCORD_INVITE_URL = "https://discord.gg/F4saKNQrYQ";

export function GET() {
    permanentRedirect(DISCORD_INVITE_URL);
}
