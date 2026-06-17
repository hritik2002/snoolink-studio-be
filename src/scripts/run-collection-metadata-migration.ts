/**
 * Applies COLLECTION_METADATA_EXTEND.sql to the Supabase Postgres database.
 *
 * Usage:
 *   npm run migrate:collection-metadata
 *
 * Connection (first match wins):
 *   DATABASE_URL=postgresql://...
 *   SUPABASE_DB_PASSWORD=...  (uses SUPABASE_URL from .env)
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_FILE = path.join(__dirname, "COLLECTION_METADATA_EXTEND.sql");

function getConnectionString(): string {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const dbPassword =
    process.env.SUPABASE_DB_PASSWORD?.trim() ||
    process.env.SUPABASE_DB_PASS?.trim();

  if (!supabaseUrl || !dbPassword) {
    throw new Error(
      "Missing database credentials. Set DATABASE_URL or SUPABASE_DB_PASSWORD in snoolink-studio-be/.env\n" +
        "Find the password in Supabase Dashboard → Project Settings → Database → Database password"
    );
  }

  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const host = process.env.SUPABASE_DB_HOST?.trim() || `db.${ref}.supabase.co`;
  const port = process.env.SUPABASE_DB_PORT?.trim() || "5432";
  const user = process.env.SUPABASE_DB_USER?.trim() || "postgres";
  const database = process.env.SUPABASE_DB_NAME?.trim() || "postgres";

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(dbPassword)}@${host}:${port}/${database}`;
}

async function verifyColumns(client: pg.Client) {
  const { rows } = await client.query<{
    column_name: string;
  }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'collection_metadata'
      AND column_name IN (
        'description',
        'collection_type',
        'settings',
        'segmentation_config'
      )
    ORDER BY column_name
  `);

  return rows.map((r) => r.column_name);
}

async function main() {
  const sql = fs.readFileSync(SQL_FILE, "utf8");
  const connectionString = getConnectionString();
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  console.log("Connecting to Supabase Postgres…");
  await client.connect();

  try {
    console.log(`Running migration: ${path.basename(SQL_FILE)}`);
    await client.query(sql);

    const columns = await verifyColumns(client);
    const expected = [
      "collection_type",
      "description",
      "segmentation_config",
      "settings",
    ];
    const missing = expected.filter((c) => !columns.includes(c));

    if (missing.length > 0) {
      throw new Error(`Migration ran but columns still missing: ${missing.join(", ")}`);
    }

    console.log("✓ Migration applied successfully");
    console.log("✓ Verified columns on collection_metadata:", columns.join(", "));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
