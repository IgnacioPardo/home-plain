import { resolve } from "node:path";
import { z } from "zod";
import { isPasswordHash } from "./auth/password.ts";

const databaseUrl = z
    .string()
    .url()
    .refine(
        (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
        "A PostgreSQL DATABASE_URL is required",
    );
export function readDatabaseEnvironment(input: NodeJS.ProcessEnv = process.env) {
    return z.object({ DATABASE_URL: databaseUrl }).parse(input);
}
export function readEnvironment(input: NodeJS.ProcessEnv = process.env) {
    const env = z
        .object({
            DATABASE_URL: databaseUrl,
            OPENAI_API_KEY: z.string().default(""),
            AGENT_MODEL: z.string().trim().default(""),
            NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
            HOST: z.string().default("127.0.0.1"),
            PORT: z.coerce.number().int().min(1).max(65535).default(3000),
            APP_ORIGIN: z.string().url().default("http://localhost:5173"),
            STATIC_ROOT: z
                .string()
                .optional()
                .transform((path) => (path ? resolve(path) : undefined)),
            HOME_MEDIA_DIRECTORY: z
                .string()
                .default("../../data/media")
                .transform((path) => resolve(path)),
        })
        .parse(input);
    if (Boolean(env.OPENAI_API_KEY) !== Boolean(env.AGENT_MODEL))
        throw new Error("Configure both OPENAI_API_KEY and AGENT_MODEL, or leave both unset.");
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
    return env;
}
export function readBootstrapEnvironment(input: NodeJS.ProcessEnv = process.env) {
    const env = z
        .object({
            DATABASE_URL: databaseUrl,
            HOUSEHOLD_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000902"),
            HOUSEHOLD_NAME: z.string().trim().min(1).default("Hogar de ejemplo"),
            AUTH_SHARED_USERNAME: z.string().trim().min(1).max(64).default("home"),
            AUTH_SHARED_PASSWORD_HASH: z
                .string()
                .refine(isPasswordHash, "A valid password hash is required"),
            AUTH_OWNER_USERNAME: z.string().trim().min(1).max(64).default("owner"),
            AUTH_OWNER_PASSWORD_HASH: z
                .string()
                .refine(isPasswordHash, "A valid password hash is required"),
        })
        .parse(input);
    if (
        env.AUTH_SHARED_USERNAME === env.AUTH_OWNER_USERNAME ||
        env.AUTH_SHARED_PASSWORD_HASH === env.AUTH_OWNER_PASSWORD_HASH
    )
        throw new Error(
            "Use separate usernames and credentials for the shared and owner accounts.",
        );
    return env;
}
export type Environment = ReturnType<typeof readEnvironment>;

export function readTestDatabaseEnvironment(input: NodeJS.ProcessEnv = process.env) {
    const parsed = z.object({ TEST_DATABASE_URL: databaseUrl }).safeParse(input);
    if (!parsed.success || new URL(parsed.data.TEST_DATABASE_URL).pathname !== "/home_plain_test")
        throw new Error(
            "Set TEST_DATABASE_URL to a disposable home_plain_test PostgreSQL database. Integration tests never skip persistence checks.",
        );
    return parsed.data;
}
