import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema.ts";

export function connectDatabase(connectionString: string) {
    const pool = new Pool({
        connectionString,
        max: 10,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
    });
    // Handle idle disconnects without logging connection options or credentials.
    pool.on("error", () => {});
    const db = drizzle(pool, { schema });
    let closing: Promise<void> | undefined;
    return { db, close: () => (closing ??= pool.end()) };
}
export type HomeDatabase = ReturnType<typeof connectDatabase>["db"];
export async function migrateDatabase(db: HomeDatabase, migrationsSchema = "drizzle") {
    // Serialize migrations across CLI processes; migration SQL is committed and reviewed.
    const client = await db.$client.connect();
    try {
        await client.query("SELECT pg_advisory_lock(704821)");
        await migrate(drizzle(client), {
            migrationsSchema,
            migrationsFolder: fileURLToPath(new URL("../../migrations", import.meta.url)),
        });
    } finally {
        try {
            await client.query("SELECT pg_advisory_unlock(704821)");
        } finally {
            client.release();
        }
    }
}
