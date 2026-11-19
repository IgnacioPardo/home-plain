import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { connectDatabase, HomeStore, AgentRunStore, startAgentWorker } from "@repo/backend";
import { logger } from "@repo/logger";
import { readEnvironment } from "./env.ts";
import { createApp } from "./app.ts";
import { createOpenAIPlanner } from "./agent-provider.ts";
import { AuthenticationService } from "./auth/auth.service.ts";

export async function start() {
    const env = readEnvironment();
    const database = connectDatabase(env.DATABASE_URL);
    let stopWorker: (() => Promise<void>) | undefined;
    try {
        await database.db.execute("SELECT 1 FROM households LIMIT 1");
        await database.db.execute("SELECT 1 FROM agent_runs LIMIT 1");
        const store = new HomeStore(database.db, env.APP_ORIGIN);
        const auth = new AuthenticationService(store);
        const agent = new AgentRunStore(database.db, env.APP_ORIGIN, Boolean(env.OPENAI_API_KEY));
        if (env.OPENAI_API_KEY)
            stopWorker = startAgentWorker(
                agent,
                createOpenAIPlanner(env.OPENAI_API_KEY, env.AGENT_MODEL),
            );
        const app = createApp(store, env.APP_ORIGIN, auth, env.HOME_MEDIA_DIRECTORY, agent);
        if (env.STATIC_ROOT) {
            app.use("/*", serveStatic({ root: env.STATIC_ROOT }));
            app.get("*", (c, next) =>
                /^\/(trpc|auth|assets|media)(\/|$)/.test(c.req.path)
                    ? next()
                    : serveStatic({ root: env.STATIC_ROOT!, path: "index.html" })(c, next),
            );
        }
        const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST });
        logger.info("Home is listening", { host: env.HOST, port: env.PORT });
        return async () => {
            try {
                await new Promise<void>((resolve, reject) =>
                    server.close((error) => (error ? reject(error) : resolve())),
                );
            } finally {
                await stopWorker?.();
                await database.close();
            }
        };
    } catch {
        await stopWorker?.();
        await database.close();
        throw new Error(
            "Database startup failed. Check the connection and run the committed migrations.",
        );
    }
}
