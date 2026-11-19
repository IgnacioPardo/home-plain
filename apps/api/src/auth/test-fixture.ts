import type { Account, AccountReader, HomeRepository } from "@repo/backend";
import { HomeError } from "@repo/backend";
import { AuthenticationService } from "./auth.service.ts";

export const testPasswords = {
    home: "test-shared-password-only",
    owner: "test-owner-password-only",
};
export const testHashes = {
    home: `scrypt$131072$8$1$${"a".repeat(22)}$${"b".repeat(86)}`,
    owner: `scrypt$131072$8$1$${"c".repeat(22)}$${"d".repeat(86)}`,
};
export const testAccounts: Account[] = [
    {
        userId: "00000000-0000-4000-8000-000000000001",
        householdId: "00000000-0000-4000-8000-000000000901",
        username: "home",
        role: "commenter",
        passwordHash: testHashes.home,
    },
    {
        userId: "00000000-0000-4000-8000-000000000002",
        householdId: "00000000-0000-4000-8000-000000000901",
        username: "owner",
        role: "owner",
        passwordHash: testHashes.owner,
    },
];
export const testAccountReader: AccountReader = {
    findAccount: async (username) =>
        testAccounts.find((account) => account.username === username) ?? null,
    findIdentity: async (userId, householdId) =>
        testAccounts.find(
            (account) => account.userId === userId && account.householdId === householdId,
        ) ?? null,
};
export const verifyTestPassword = async (password: string, hash: string) =>
    hash === testHashes.home
        ? password === testPasswords.home
        : hash === testHashes.owner && password === testPasswords.owner;
export function createTestAuth(now: () => number = Date.now) {
    return new AuthenticationService(testAccountReader, now, verifyTestPassword);
}
// Transport-only tests use an empty domain. Persistence tests use real PostgreSQL.
export const emptyStore: HomeRepository = {
    dashboard: async () => ({ configured: true, state: "live", issue: null, snapshot: null }),
    setPurchased: async () => {
        throw new HomeError("not_found");
    },
    collection: async () => null,
    collectionStatus: async () => ({ state: "missing", importedAt: null, issue: null }),
    contentIndex: async () => ({ configured: true, state: "live", syncedAt: null, documents: [] }),
    document: async () => {
        throw new HomeError("not_found");
    },
    moodboard: async () => null,
    listFeedback: async () => ({
        configured: true,
        canCreate: true,
        state: "live",
        issue: null,
        snapshot: null,
    }),
    createFeedback: async () => {
        throw new HomeError("not_found");
    },
    hasMedia: async () => true,
};
