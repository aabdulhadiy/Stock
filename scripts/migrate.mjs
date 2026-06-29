// Apply pending migrations using drizzle-orm's migrator (plain Node, no
// drizzle-kit needed at runtime). Reads SQL from ./drizzle. Run on container
// boot before starting the server.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
try {
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("[migrate] migrations applied");
} catch (err) {
  console.error("[migrate] failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
