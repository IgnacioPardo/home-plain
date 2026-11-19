import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { hashPassword } from "../apps/api/src/auth/password.ts";
import { snapshotSchema } from "../packages/backend/src/shopping/shopping.schema.ts";
import { collectionSnapshotSchema } from "../packages/backend/src/collection/collection.schema.ts";

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
const shopping = snapshotSchema.parse(
    JSON.parse(await readFile(resolve(root, "examples/notion-shopping.json"), "utf8")),
);
const collection = collectionSnapshotSchema.parse(
    JSON.parse(await readFile(resolve(root, "examples/home-collection.json"), "utf8")),
);
const sharedPassword = randomBytes(24).toString("base64url");
const ownerPassword = randomBytes(24).toString("base64url");
const sharedHash = await hashPassword(sharedPassword);
const ownerHash = await hashPassword(ownerPassword);
const environment = (await readFile(resolve(root, ".env.example"), "utf8"))
    .replace("AUTH_SHARED_PASSWORD_HASH=", () => `AUTH_SHARED_PASSWORD_HASH='${sharedHash}'`)
    .replace("AUTH_OWNER_PASSWORD_HASH=", () => `AUTH_OWNER_PASSWORD_HASH='${ownerHash}'`);
await mkdir(resolve(root, "data"), { mode: 0o700 });
await writeFile(resolve(root, ".env"), environment, { mode: 0o600, flag: "wx" });
await writeFile(resolve(root, "data/notion-shopping.json"), JSON.stringify(shopping, null, 2), {
    mode: 0o600,
    flag: "wx",
});
await writeFile(resolve(root, "data/home-collection.json"), JSON.stringify(collection, null, 2), {
    mode: 0o600,
    flag: "wx",
});
await writeFile(
    resolve(root, "data/demo-access.txt"),
    `Local demo credentials\n\nShared username: home\nPassword: ${sharedPassword}\n\nOwner username: owner\nPassword: ${ownerPassword}\n`,
    { mode: 0o600, flag: "wx" },
);
console.log("Demo ready. Login details are in ignored data/demo-access.txt. Run pnpm dev.");
