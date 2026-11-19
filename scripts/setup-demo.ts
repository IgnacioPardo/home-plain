import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { hashPassword } from "../apps/api/src/auth/password.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const name of [".env", "data"]) {
    try {
        await access(resolve(root, name));
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
        throw error;
    }
    throw new Error(`Refusing to replace existing ${name}; use a fresh checkout for the demo.`);
}
const sharedPassword = randomBytes(24).toString("base64url");
const ownerPassword = randomBytes(24).toString("base64url");
const sharedHash = await hashPassword(sharedPassword);
const ownerHash = await hashPassword(ownerPassword);
const databasePassword = randomBytes(24).toString("hex");
const environment = (await readFile(resolve(root, ".env.example"), "utf8"))
    .replaceAll("replace-with-local-database-password", databasePassword)
    .replace("AUTH_SHARED_PASSWORD_HASH=", () => `AUTH_SHARED_PASSWORD_HASH='${sharedHash}'`)
    .replace("AUTH_OWNER_PASSWORD_HASH=", () => `AUTH_OWNER_PASSWORD_HASH='${ownerHash}'`);
await mkdir(resolve(root, "data"), { mode: 0o700 });
await writeFile(resolve(root, ".env"), environment, { mode: 0o600, flag: "wx" });
await writeFile(
    resolve(root, "data/demo-access.txt"),
    `Local demo credentials\n\nShared username: home\nPassword: ${sharedPassword}\n\nOwner username: owner\nPassword: ${ownerPassword}\n`,
    { mode: 0o600, flag: "wx" },
);
console.log(
    "Demo ready. Login details are in ignored data/demo-access.txt. Start PostgreSQL, run pnpm db:migrate and pnpm demo:seed, then pnpm dev.",
);
