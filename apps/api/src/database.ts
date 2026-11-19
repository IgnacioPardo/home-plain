import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { bootstrapHousehold, connectDatabase, importHome, migrateDatabase } from "@repo/backend";
import { readBootstrapEnvironment, readDatabaseEnvironment } from "./env.ts";

const [command, file] = process.argv.slice(2);
if (!["migrate", "seed", "import", "bootstrap"].includes(command ?? ""))
    throw new Error("Usage: database.ts <migrate|bootstrap|seed|import> [bundle.json]");
const connection = connectDatabase(readDatabaseEnvironment().DATABASE_URL);
try {
    if (command === "migrate") {
        await migrateDatabase(connection.db);
        console.log("Database migrations applied.");
    } else {
        const env = readBootstrapEnvironment();
        await bootstrapHousehold(connection.db, {
            id: env.HOUSEHOLD_ID,
            name: env.HOUSEHOLD_NAME,
            accounts: [
                {
                    username: env.AUTH_SHARED_USERNAME,
                    passwordHash: env.AUTH_SHARED_PASSWORD_HASH,
                    role: "commenter",
                },
                {
                    username: env.AUTH_OWNER_USERNAME,
                    passwordHash: env.AUTH_OWNER_PASSWORD_HASH,
                    role: "owner",
                },
            ],
        });
        if (command !== "bootstrap") {
            const root = fileURLToPath(new URL("../../../", import.meta.url));
            if (command === "import" && !file)
                throw new Error("Provide a private import bundle path.");
            const bundle =
                command === "import"
                    ? JSON.parse(await readFile(resolve(file!), "utf8"))
                    : {
                          shopping: JSON.parse(
                              await readFile(resolve(root, "examples/shopping.json"), "utf8"),
                          ),
                          collection: JSON.parse(
                              await readFile(
                                  resolve(root, "examples/home-collection.json"),
                                  "utf8",
                              ),
                          ),
                      };
            console.log(JSON.stringify(await importHome(connection.db, env.HOUSEHOLD_ID, bundle)));
        }
    }
} catch {
    // Private files and driver errors may include credentials or records. Report no payloads.
    console.error(
        "Database operation failed. Check configuration, committed migrations and validated input. Existing accounts are never reset by bootstrap.",
    );
    process.exitCode = 1;
} finally {
    await connection.close();
}
