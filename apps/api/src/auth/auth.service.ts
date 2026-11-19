import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthSession } from "@repo/backend";
import { isPasswordHash, verifyPassword } from "./password.ts";

export type Account = { username: string; role: AuthSession["role"]; passwordHash: string };
type StoredSession = { session: AuthSession; expiresAt: number };
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const attemptWindow = 15 * 60 * 1000;
const sessionKey = (token: string) => createHash("sha256").update(token).digest("hex");

export class AuthenticationService {
    private readonly sessions = new Map<string, StoredSession>();
    private attempts: { at: number; username: string }[] = [];
    private verifying = false;

    constructor(
        private readonly accounts: readonly Account[],
        private readonly now: () => number = Date.now,
        private readonly verify: typeof verifyPassword = verifyPassword,
    ) {
        if (
            accounts.length !== 2 ||
            new Set(accounts.map((account) => account.username)).size !== 2 ||
            new Set(accounts.map((account) => account.role)).size !== 2 ||
            accounts.some((account) => !account.username || !isPasswordHash(account.passwordHash))
        )
            throw new Error("Configure one owner and one commenter with valid password hashes.");
    }

    async login(
        username: string,
        password: string,
    ): Promise<
        | { status: "ok"; token: string; session: AuthSession }
        | { status: "invalid" }
        | { status: "limited"; retryAfter: number }
    > {
        const now = this.now();
        this.attempts = this.attempts.filter((attempt) => now - attempt.at < attemptWindow);
        const account = this.accounts.find((candidate) => candidate.username === username);
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
            const valid = await this.verify(password, (account ?? this.accounts[0]!).passwordHash);
            if (!valid || !account) return { status: "invalid" };
            this.attempts = this.attempts.filter((attempt) => attempt.username !== bucket);
            this.removeExpired();
            if (this.sessions.size >= 128) this.sessions.delete(this.sessions.keys().next().value!);
            const token = randomBytes(32).toString("base64url");
            const session = {
                username: account.username,
                role: account.role,
                csrfToken: randomBytes(32).toString("base64url"),
            };
            this.sessions.set(sessionKey(token), {
                session,
                expiresAt: this.now() + sessionLifetime,
            });
            return { status: "ok", token, session };
        } finally {
            this.verifying = false;
        }
    }

    read(token: string | undefined): AuthSession | null {
        this.removeExpired();
        if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
        return this.sessions.get(sessionKey(token))?.session ?? null;
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
