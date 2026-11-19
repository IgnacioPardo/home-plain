import { resolve } from "node:path";
import { z } from "zod";
import { isPasswordHash } from "./auth/password.ts";

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    APP_ORIGIN: z.string().url().default("http://localhost:5173"),
    AUTH_SHARED_USERNAME: z.string().trim().min(1).max(64).default("home"),
    AUTH_SHARED_PASSWORD_HASH: z
        .string()
        .refine(isPasswordHash, "A valid scrypt password hash is required"),
    AUTH_OWNER_USERNAME: z.string().trim().min(1).max(64).default("owner"),
    AUTH_OWNER_PASSWORD_HASH: z
        .string()
        .refine(isPasswordHash, "A valid scrypt password hash is required"),
    NOTION_API_TOKEN: z
        .string()
        .optional()
        .transform((token) => token?.trim() || undefined),
    NOTION_FEEDBACK_DATA_SOURCE_ID: z
        .string()
        .trim()
        .optional()
        .transform((value) => value || undefined)
        .pipe(z.string().uuid().optional()),
    NOTION_FEEDBACK_CACHE_FILE: z
        .string()
        .default("../../data/notion-feedback.json")
        .transform((path) => resolve(path)),
    NOTION_FEEDBACK_JOURNAL_FILE: z
        .string()
        .default("../../data/notion-feedback-operations.json")
        .transform((path) => resolve(path)),
    NOTION_PRODUCT_REFERENCES_DATA_SOURCE_ID: z
        .string()
        .trim()
        .optional()
        .transform((value) => value || undefined)
        .pipe(z.string().uuid().optional()),
    NOTION_HOME_PAGE_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000901"),
    NOTION_SHOPPING_DATA_SOURCE_ID: z
        .string()
        .uuid()
        .default("00000000-0000-4000-8000-000000000902"),
    NOTION_CACHE_FILE: z
        .string()
        .default("../../data/notion-shopping.json")
        .transform((path) => resolve(path)),
    NOTION_SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(300),
    STATIC_ROOT: z
        .string()
        .optional()
        .transform((path) => (path ? resolve(path) : undefined)),
    HOME_COLLECTION_FILE: z
        .string()
        .default("../../data/home-collection.json")
        .transform((path) => resolve(path)),
    HOME_CONTENT_FILE: z
        .string()
        .default("../../data/home-content.json")
        .transform((path) => resolve(path)),
    HOME_MOODBOARD_FILE: z
        .string()
        .default("../../data/home-moodboard.json")
        .transform((path) => resolve(path)),
    HOME_MEDIA_DIRECTORY: z
        .string()
        .default("../../data/media")
        .transform((path) => resolve(path)),
});
export function readEnvironment(input: NodeJS.ProcessEnv = process.env) {
    const env = envSchema.parse(input);
    if (
        env.NOTION_API_TOKEN &&
        [env.NOTION_HOME_PAGE_ID, env.NOTION_SHOPPING_DATA_SOURCE_ID].some((id) =>
            id.startsWith("00000000-0000-4000-8000-"),
        )
    )
        throw new Error(
            "Set your own Notion home page and shopping data source IDs before enabling sync.",
        );
    const origin = new URL(env.APP_ORIGIN);
    if (
        origin.username ||
        origin.password ||
        origin.pathname !== "/" ||
        origin.search ||
        origin.hash ||
        (origin.protocol !== "https:" &&
            !(
                env.NODE_ENV !== "production" &&
                origin.protocol === "http:" &&
                ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
            ))
    )
        throw new Error("APP_ORIGIN must be an HTTPS origin (HTTP is allowed only on loopback).");
    if (env.AUTH_SHARED_USERNAME === env.AUTH_OWNER_USERNAME)
        throw new Error("Shared and owner usernames must differ.");
    if (env.AUTH_SHARED_PASSWORD_HASH === env.AUTH_OWNER_PASSWORD_HASH)
        throw new Error("Shared and owner credentials must differ.");
    return env;
}
export type Environment = z.infer<typeof envSchema>;
