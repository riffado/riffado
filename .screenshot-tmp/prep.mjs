// Mint a better-auth session for the existing user + emit the signed cookie.
// No account creation, no password entry — just a DB session row whose token
// we sign exactly the way better-auth does (HMAC-SHA256 -> base64).
import crypto from "node:crypto";
import { writeFileSync } from "node:fs";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const SECRET = process.env.BETTER_AUTH_SECRET;
if (!DATABASE_URL || !SECRET) {
    console.error("Missing DATABASE_URL or BETTER_AUTH_SECRET");
    process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

// Mirror better-auth crypto.makeSignature: HMAC-SHA256(value, secret) -> base64.
function makeSignature(value, secret) {
    return crypto.createHmac("sha256", secret).update(value).digest("base64");
}

const [user] = await sql`
    select id, email from users order by created_at asc limit 1
`;
if (!user) {
    console.error("No user found to mint a session for.");
    process.exit(1);
}

const token = crypto.randomBytes(24).toString("hex");
const sessionId = crypto.randomBytes(16).toString("hex");
const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);

await sql`
    insert into sessions (id, token, user_id, expires_at, ip_address, user_agent)
    values (${sessionId}, ${token}, ${user.id}, ${expiresAt}, ${"127.0.0.1"}, ${"screenshot-bot"})
`;

const cookieValue = `${token}.${makeSignature(token, SECRET)}`;
writeFileSync(
    new URL("./auth.json", import.meta.url),
    JSON.stringify(
        {
            cookieName: "better-auth.session_token",
            cookieValue,
            email: user.email,
            userId: user.id,
            sessionId,
        },
        null,
        2,
    ),
);
console.log("Minted session for", user.email, "(session", sessionId + ")");
await sql.end();
