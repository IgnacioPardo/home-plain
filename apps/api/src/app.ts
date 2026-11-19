import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { trpcServer } from "@hono/trpc-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { z } from "zod";
import {
    buildRouter,
    authSessionSchema,
    type HomeRepository,
    type AgentRunStore,
    type Identity,
} from "@repo/backend";
import type { AuthenticationService } from "./auth/auth.service.ts";

const credentialsSchema = z
    .object({ username: z.string().min(1).max(64), password: z.string().min(1).max(1024) })
    .strict();
export function createApp(
    store: HomeRepository,
    origin: string,
    auth: AuthenticationService,
    mediaDirectory?: string,
    agent?: AgentRunStore,
) {
    const app = new Hono<{ Variables: { session: Identity | null } }>();
    const allowed = new URL(origin);
    const secure = allowed.protocol === "https:";
    const cookieName = secure ? "__Host-home-session" : "home-session";
    const cookieOptions = { httpOnly: true, secure, sameSite: "Lax" as const, path: "/" };
    app.use(
        "*",
        secureHeaders({
            contentSecurityPolicy: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:"],
                connectSrc: ["'self'"],
                frameAncestors: ["'none'"],
                formAction: ["'self'"],
            },
            referrerPolicy: "no-referrer",
        }),
    );
    app.get("/health", (c) => c.json({ status: "ok" }));
    app.use("*", async (c, next) => {
        c.header("Cache-Control", "no-store");
        c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
        const host = c.req.header("host") ?? new URL(c.req.url).host;
        if (host !== allowed.host) return c.json({ error: "Untrusted host" }, 403);
        const requestOrigin = c.req.header("origin");
        if (requestOrigin && requestOrigin !== allowed.origin)
            return c.json({ error: "Untrusted origin" }, 403);
        if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && requestOrigin !== allowed.origin)
            return c.json({ error: "Origin required" }, 403);
        const session = await auth.read(getCookie(c, cookieName));
        c.set("session", session);
        const privatePath = /^\/(trpc|media)(\/|$)/.test(c.req.path);
        if (privatePath && !session) return c.json({ error: "Iniciá sesión para continuar." }, 401);
        if (
            privatePath &&
            !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
            !auth.verifyCsrf(session!, c.req.header("x-csrf-token"))
        )
            return c.json({ error: "La sesión cambió. Volvé a iniciar sesión." }, 403);
        await next();
        c.header("Cache-Control", "no-store");
    });
    app.get("/auth/session", (c) =>
        c.json({ session: c.get("session") ? authSessionSchema.parse(c.get("session")) : null }),
    );
    app.post(
        "/auth/login",
        bodyLimit({
            maxSize: 8192,
            onError: (c) => c.json({ error: "Solicitud demasiado grande." }, 413),
        }),
        async (c) => {
            let input: z.infer<typeof credentialsSchema>;
            try {
                input = credentialsSchema.parse(await c.req.json());
            } catch {
                return c.json({ error: "Completá el usuario y la contraseña." }, 400);
            }
            const result = await auth.login(input.username, input.password);
            if (result.status === "limited") {
                c.header("Retry-After", String(result.retryAfter));
                return c.json(
                    {
                        error: "Demasiados intentos. Esperá unos minutos antes de volver a intentar.",
                    },
                    429,
                );
            }
            if (result.status === "invalid")
                return c.json({ error: "El usuario o la contraseña no son correctos." }, 401);
            // Login always rotates an existing session, including when changing roles.
            auth.logout(getCookie(c, cookieName));
            setCookie(c, cookieName, result.token, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 });
            return c.json({ session: authSessionSchema.parse(result.session) });
        },
    );
    app.post("/auth/logout", (c) => {
        const session = c.get("session");
        if (!session) return c.json({ error: "Iniciá sesión para continuar." }, 401);
        if (!auth.verifyCsrf(session, c.req.header("x-csrf-token")))
            return c.json({ error: "La sesión cambió. Volvé a iniciar sesión." }, 403);
        auth.logout(getCookie(c, cookieName));
        deleteCookie(c, cookieName, cookieOptions);
        return c.json({ session: null });
    });
    app.use(
        "/trpc/*",
        trpcServer({
            endpoint: "/trpc",
            router: buildRouter(store, agent),
            createContext: (_options, c) => ({ session: c.get("session") }),
        }),
    );
    if (mediaDirectory) {
        app.get("/media/:name", async (c, next) => {
            if (!/^[a-zA-Z0-9_-]+\.(png|jpe?g|webp|avif)$/.test(c.req.param("name")))
                return c.notFound();
            if (!(await store.hasMedia(c.get("session")!, c.req.param("name"))))
                return c.notFound();
            const response = await serveStatic({
                root: mediaDirectory,
                rewriteRequestPath: (path) => path.replace(/^\/media\//, ""),
            })(c, next);
            return response ?? c.res;
        });
    }
    app.onError((_error, c) => c.json({ error: "No se pudo completar la operación." }, 503));
    app.notFound((c) => c.json({ error: "Not found" }, 404));
    return app;
}
