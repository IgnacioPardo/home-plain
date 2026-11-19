import { z } from "zod";
import type { AuthSession } from "@repo/backend";

const responseSchema: z.ZodType<{ session: AuthSession | null }> = z.object({
    session: z
        .object({
            username: z.string().min(1).max(64),
            role: z.enum(["owner", "commenter"]),
            csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        })
        .nullable(),
});
const errorSchema = z.object({ error: z.string().max(250) });
async function sessionRequest(path: string, init?: RequestInit): Promise<AuthSession | null> {
    const response = await fetch(`/auth/${path}`, {
        credentials: "same-origin",
        cache: "no-store",
        ...init,
    });
    const data: unknown = await response.json();
    if (!response.ok) {
        const error = errorSchema.safeParse(data);
        throw new Error(
            error.success ? error.data.error : "No se pudo conectar. Volvé a intentar.",
        );
    }
    return responseSchema.parse(data).session;
}
export function readHomeSession() {
    return sessionRequest("session");
}
export function loginHome(username: string, password: string) {
    return sessionRequest("login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
    });
}
export function logoutHome(csrfToken: string) {
    return sessionRequest("logout", { method: "POST", headers: { "x-csrf-token": csrfToken } });
}
