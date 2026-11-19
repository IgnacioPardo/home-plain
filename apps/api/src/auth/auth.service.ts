import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthSession, Identity, AccountReader } from "@repo/backend";
import { verifyPassword } from "./password.ts";

type StoredSession = { session: Identity; passwordHash: string; expiresAt: number };
const dummyHash = `scrypt$131072$8$1$${"a".repeat(22)}$${"b".repeat(86)}`;
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const attemptWindow = 15 * 60 * 1000;
const sessionKey = (token: string) => createHash("sha256").update(token).digest("hex");

export class AuthenticationService {
    private readonly sessions = new Map<string, StoredSession>();
    private attempts: { at: number; username: string }[] = [];
    private verifying = false;

    constructor(
        private readonly accounts: AccountReader,
        private readonly now: () => number = Date.now,
        private readonly verify: typeof verifyPassword = verifyPassword,
    ) {}

    async login(
        username: string,
        password: string,
    ): Promise<
        | { status: "ok"; token: string; session: Identity }
        | { status: "invalid" }
        | { status: "limited"; retryAfter: number }
    > {
        const now = this.now();
        this.attempts = this.attempts.filter((attempt) => now - attempt.at < attemptWindow);
        const account = await this.accounts.findAccount(username);
        const bucket = account?.username ?? "unknown";
        const matching = this.attempts.filter((attempt) => attempt.username === bucket);
        const exhausted =
            this.attempts.length >= 20 ? this.attempts : matching.length >= 5 ? matching : [];
        if (this.verifying || exhausted.length)
            return {
                status: "limited",
                retryAfter: this.verifying
                    ? 2
                    : Math.max(1, Math.ceil((exhausted[0]!.at + attemptWindow - now) / 1000)),
            };
        this.attempts.push({ at: now, username: bucket });
        this.verifying = true;
        try {
            // Unknown names still perform the same password work. Ignore asserted identities.
            const valid = await this.verify(password, account?.passwordHash ?? dummyHash);
            if (!valid || !account) return { status: "invalid" };
            this.attempts = this.attempts.filter((attempt) => attempt.username !== bucket);
            this.removeExpired();
            if (this.sessions.size >= 128) this.sessions.delete(this.sessions.keys().next().value!);
            const token = randomBytes(32).toString("base64url");
            const session = {
                userId: account.userId,
                householdId: account.householdId,
                username: account.username,
                role: account.role,
                csrfToken: randomBytes(32).toString("base64url"),
            };
            this.sessions.set(sessionKey(token), {
                session,
                passwordHash: account.passwordHash,
                expiresAt: this.now() + sessionLifetime,
            });
            return { status: "ok", token, session };
        } finally {
            this.verifying = false;
        }
    }

    async read(token: string | undefined): Promise<Identity | null> {
        this.removeExpired();
        if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
        const stored = this.sessions.get(sessionKey(token));
        if (!stored) return null;
        const account = await this.accounts.findIdentity(
            stored.session.userId,
            stored.session.householdId,
        );
        if (!account || account.passwordHash !== stored.passwordHash) {
            this.logout(token);
            return null;
        }
        return { ...stored.session, username: account.username, role: account.role };
    }
    logout(token: string | undefined): void {
        if (token) this.sessions.delete(sessionKey(token));
    }
    verifyCsrf(session: AuthSession, token: string | undefined): boolean {
        if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
        return timingSafeEqual(Buffer.from(token), Buffer.from(session.csrfToken));
    }
    private removeExpired(): void {
        for (const [key, stored] of this.sessions)
            if (stored.expiresAt <= this.now()) this.sessions.delete(key);
    }
}
