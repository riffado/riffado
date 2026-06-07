// Remove everything the screenshot run created: the seeded demo providers and
// the minted session. Leaves the account exactly as it was.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const DIR = "C:/Users/r0073dl053r/Downloads/riffado/.screenshot-tmp";
const sql = postgres(DATABASE_URL, { max: 1 });

let createdIds = [];
try {
    createdIds = JSON.parse(readFileSync(`${DIR}/created.json`, "utf8"));
} catch {}

if (createdIds.length) {
    await sql`delete from api_credentials where id in ${sql(createdIds)}`;
}

let sessionId = null;
try {
    sessionId = JSON.parse(readFileSync(`${DIR}/auth.json`, "utf8")).sessionId;
} catch {}
if (sessionId) {
    await sql`delete from sessions where id = ${sessionId}`;
}

console.log(
    `Cleaned up ${createdIds.length} seeded provider(s) and ${sessionId ? 1 : 0} session.`,
);
await sql.end();
