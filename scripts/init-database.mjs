import { readFile } from "node:fs/promises";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set before initializing the database.");
}

const schema = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
  await pool.query(schema);
  console.log("Database schema initialized.");
} finally {
  await pool.end();
}
