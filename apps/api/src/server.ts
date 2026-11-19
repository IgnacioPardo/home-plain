import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
    CollectionRepository,
    CollectionService,
    FeedbackService,
    FeedbackRepository,
    NotionFeedbackClient,
    MoodboardRepository,
    MoodboardService,
    NotionClient,
    ShoppingService,
    SnapshotRepository,
    ContentRepository,
    ContentService,
    NotionContentReader,
    NotionRequestQueue,
} from "@repo/backend";
import { logger } from "@repo/logger";
import { readEnvironment } from "./env.ts";
import { createApp } from "./app.ts";
import { AuthenticationService } from "./auth/auth.service.ts";

export async function start() {
    const env = readEnvironment();
    const notionRequests = new NotionRequestQueue();
    const auth = new AuthenticationService([
        {
            username: env.AUTH_SHARED_USERNAME,
            role: "commenter",
            passwordHash: env.AUTH_SHARED_PASSWORD_HASH,
        },
        {
            username: env.AUTH_OWNER_USERNAME,
            role: "owner",
            passwordHash: env.AUTH_OWNER_PASSWORD_HASH,
        },
    ]);
    const service = new ShoppingService(
        {
            dataSourceId: env.NOTION_SHOPPING_DATA_SOURCE_ID,
            intervalMs: env.NOTION_SYNC_INTERVAL_SECONDS * 1000,
        },
        new SnapshotRepository(env.NOTION_CACHE_FILE, env.NOTION_SHOPPING_DATA_SOURCE_ID),
        env.NOTION_API_TOKEN
            ? new NotionClient(
                  {
                      token: env.NOTION_API_TOKEN,
                      dataSourceId: env.NOTION_SHOPPING_DATA_SOURCE_ID,
                  },
                  notionRequests.fetch,
              )
            : null,
    );
    await service.initialize();
    const content = new ContentService(
        {
            rootPageId: env.NOTION_HOME_PAGE_ID,
            intervalMs: env.NOTION_SYNC_INTERVAL_SECONDS * 1000,
        },
        new ContentRepository(env.HOME_CONTENT_FILE, env.NOTION_HOME_PAGE_ID),
        env.NOTION_API_TOKEN
            ? new NotionContentReader(
                  {
                      token: env.NOTION_API_TOKEN,
                      rootPageId: env.NOTION_HOME_PAGE_ID,
                      shoppingDataSourceId: env.NOTION_SHOPPING_DATA_SOURCE_ID,
                      feedbackDataSourceId: env.NOTION_FEEDBACK_DATA_SOURCE_ID,
                      productReferencesDataSourceId: env.NOTION_PRODUCT_REFERENCES_DATA_SOURCE_ID,
                  },
                  notionRequests.fetch,
              )
            : null,
    );
    await content.initialize();
    const collection = new CollectionService(
        new CollectionRepository(env.HOME_COLLECTION_FILE, env.HOME_MEDIA_DIRECTORY),
    );
    await collection.read();
    const moodboard = new MoodboardService(new MoodboardRepository(env.HOME_MOODBOARD_FILE));
    await moodboard.initialize();
    const feedback = env.NOTION_FEEDBACK_DATA_SOURCE_ID
        ? new FeedbackService(
              {
                  dataSourceId: env.NOTION_FEEDBACK_DATA_SOURCE_ID,
                  origin: env.APP_ORIGIN,
                  intervalMs: env.NOTION_SYNC_INTERVAL_SECONDS * 1000,
              },
              new FeedbackRepository(
                  env.NOTION_FEEDBACK_CACHE_FILE,
                  env.NOTION_FEEDBACK_JOURNAL_FILE,
                  env.NOTION_FEEDBACK_DATA_SOURCE_ID,
              ),
              env.NOTION_API_TOKEN
                  ? new NotionFeedbackClient(
                        {
                            token: env.NOTION_API_TOKEN,
                            dataSourceId: env.NOTION_FEEDBACK_DATA_SOURCE_ID,
                        },
                        notionRequests.fetch,
                    )
                  : null,
              async (target) => {
                  if (target.kind === "document" && content.hasDocument(target.id))
                      return `/documentos/${target.id}`;
                  if (
                      target.kind === "shopping" &&
                      service.read().snapshot?.items.some((item) => item.id === target.id)
                  )
                      return `/lista#compra-${target.id}`;
                  if (
                      target.kind === "collection" &&
                      (await collection.read())?.entries.some((entry) => entry.id === target.id)
                  )
                      return `/coleccion#objeto-${target.id}`;
                  if (
                      target.kind === "moodboard" &&
                      (await moodboard.read())?.references.some(
                          (reference) => reference.id === target.id,
                      )
                  )
                      return `/moodboard#referencia-${target.id}`;
                  return null;
              },
          )
        : null;
    await feedback?.initialize();
    const app = createApp(
        service,
        env.APP_ORIGIN,
        collection,
        env.HOME_MEDIA_DIRECTORY,
        moodboard,
        { content, auth, feedback },
    );
    if (env.STATIC_ROOT) {
        app.use("/*", serveStatic({ root: env.STATIC_ROOT }));
        app.get("*", (c, next) =>
            c.req.path.startsWith("/trpc") ||
            c.req.path.startsWith("/auth/") ||
            c.req.path.startsWith("/assets/") ||
            c.req.path.startsWith("/media/")
                ? next()
                : serveStatic({ root: env.STATIC_ROOT!, path: "index.html" })(c, next),
        );
    }
    const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST });
    const refresh = () => {
        void service.refresh();
        void content.refresh();
        void feedback?.refresh();
    };
    refresh();
    const interval = setInterval(refresh, env.NOTION_SYNC_INTERVAL_SECONDS * 1000);
    logger.info("Home is listening", {
        host: env.HOST,
        port: env.PORT,
        notionConfigured: Boolean(env.NOTION_API_TOKEN),
    });
    return async () => {
        clearInterval(interval);
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    };
}
