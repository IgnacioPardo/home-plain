import { randomUUID } from "node:crypto";
import {
    connectDatabase,
    migrateDatabase,
    HomeStore,
    bootstrapHousehold,
    type Identity,
} from "@repo/backend";
import { readTestDatabaseEnvironment } from "./env.ts";
import { testHashes } from "./auth/test-fixture.ts";

export const homeId = "00000000-0000-4000-8000-000000000901";
export const otherHomeId = "00000000-0000-4000-8000-000000000902";
export const itemId = "00000000-0000-4000-8000-000000000001";
export const documentId = "00000000-0000-4000-8000-000000000010";
export const origin = "https://home.example.test";
export const bootstrap = {
    id: homeId,
    name: "Synthetic home",
    accounts: [
        { username: "owner", role: "owner" as const, passwordHash: testHashes.owner },
        { username: "home", role: "commenter" as const, passwordHash: testHashes.home },
    ],
};
export async function databaseFixture() {
    const url = new URL(readTestDatabaseEnvironment().TEST_DATABASE_URL);
    const admin = connectDatabase(url.href);
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    await admin.db.$client.query(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set("options", `-c search_path=${schema}`);
    const connections: ReturnType<typeof connectDatabase>[] = [];
    const open = () => {
        const connection = connectDatabase(url.href);
        connections.push(connection);
        return connection;
    };
    const connection = open();
    const close = async () => {
        await Promise.all(connections.map((entry) => entry.close()));
        await admin.db.$client.query(`DROP SCHEMA "${schema}" CASCADE`);
        await admin.close();
    };
    try {
        await migrateDatabase(connection.db, schema);
        await bootstrapHousehold(connection.db, bootstrap);
        await bootstrapHousehold(connection.db, {
            id: otherHomeId,
            name: "Other synthetic home",
            accounts: [{ username: "other", role: "owner", passwordHash: testHashes.owner }],
        });
        const store = new HomeStore(connection.db, origin);
        const identity = async (username: string): Promise<Identity> => {
            const account = await store.findAccount(username);
            if (!account) throw new Error("Missing test account");
            return { ...account, csrfToken: "synthetic-csrf-token" };
        };
        return {
            ...connection,
            disconnect: connection.close,
            store,
            schema,
            open,
            close,
            owner: await identity("owner"),
            shared: await identity("home"),
            other: await identity("other"),
        };
    } catch (error) {
        await close();
        throw error;
    }
}
