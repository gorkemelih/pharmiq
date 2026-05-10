/**
 * Drizzle migrate runner.
 * Usage: pnpm db:migrate
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:54322/postgres";

async function main() {
  console.log("→ Connecting to", connectionString.replace(/:[^:@]+@/, ":***@"));
  const sql = postgres(connectionString, { max: 1 });

  // Ensure pgvector extension exists
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  console.log("✓ pgvector extension ready");

  const db = drizzle(sql);

  console.log("→ Running migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✓ Migrations applied");

  // Post-migrate: vector + FTS indexes (idempotent, Drizzle-kit doesn't generate these)
  console.log("→ Ensuring vector & FTS indexes…");
  await sql`
    CREATE INDEX IF NOT EXISTS chunks_embedding_cosine_idx
    ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chunks_embedding_translated_cosine_idx
    ON chunks USING ivfflat (embedding_translated vector_cosine_ops) WITH (lists = 100)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chunks_content_fts_tr_idx
    ON chunks USING gin (to_tsvector('turkish', content))
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chunks_content_fts_en_idx
    ON chunks USING gin (to_tsvector('english', content))
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chunks_content_trgm_idx
    ON chunks USING gin (content gin_trgm_ops)
  `;
  console.log("✓ Indexes ready");

  await sql.end();
}

main().catch((err) => {
  console.error("✗ Migration failed:", err);
  process.exit(1);
});
