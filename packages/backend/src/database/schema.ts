import { sql } from "drizzle-orm";
import {
    pgTable,
    uuid,
    text,
    timestamp,
    integer,
    jsonb,
    primaryKey,
    unique,
    check,
    index,
    foreignKey,
    numeric,
} from "drizzle-orm/pg-core";
import type { CollectionEntry } from "../collection/collection.schema.ts";
import type { ContentDocument } from "../content/content.schema.ts";
import type { MoodboardSnapshot } from "../moodboard/moodboard.schema.ts";

export const households = pgTable("households", {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const users = pgTable("users", {
    id: uuid("id").primaryKey(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
});
export const memberships = pgTable(
    "memberships",
    {
        userId: uuid("user_id")
            .primaryKey()
            .references(() => users.id, { onDelete: "cascade" }),
        householdId: uuid("household_id")
            .notNull()
            .references(() => households.id, { onDelete: "cascade" }),
        role: text("role", { enum: ["owner", "commenter"] }).notNull(),
    },
    (t) => [
        check("membership_role", sql`${t.role} IN ('owner', 'commenter')`),
        index("memberships_household_idx").on(t.householdId),
    ],
);
export const rooms = pgTable(
    "rooms",
    {
        householdId: uuid("household_id")
            .notNull()
            .references(() => households.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
    },
    (t) => [primaryKey({ columns: [t.householdId, t.name] })],
);
export const shoppingItems = pgTable(
    "shopping_items",
    {
        householdId: uuid("household_id").notNull(),
        id: uuid("id").notNull(),
        name: text("name").notNull(),
        room: text("room").notNull(),
        url: text("url").notNull(),
        priority: text("priority").notNull(),
        status: text("status").notNull(),
        origin: text("origin").notNull(),
        initialQuantity: text("initial_quantity").notNull(),
        targetQuantity: text("target_quantity").notNull(),
        quality: text("quality").notNull(),
        condition: text("condition").notNull(),
        notes: text("notes").notNull(),
        estimatedPriceArs: numeric("estimated_price_ars", {
            precision: 16,
            scale: 2,
            mode: "number",
        }),
        reference: text("reference"),
        version: integer("version").notNull().default(0),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        primaryKey({ columns: [t.householdId, t.id] }),
        foreignKey({
            columns: [t.householdId, t.room],
            foreignColumns: [rooms.householdId, rooms.name],
        }).onDelete("restrict"),
        check(
            "shopping_price_nonnegative",
            sql`${t.estimatedPriceArs} IS NULL OR ${t.estimatedPriceArs} >= 0`,
        ),
        check("shopping_version_nonnegative", sql`${t.version} >= 0`),
    ],
);
export const collectionEntries = pgTable(
    "collection_entries",
    {
        householdId: uuid("household_id")
            .notNull()
            .references(() => households.id, { onDelete: "cascade" }),
        id: text("id").notNull(),
        payload: jsonb("payload").$type<CollectionEntry>().notNull(),
        importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
    },
    (t) => [primaryKey({ columns: [t.householdId, t.id] })],
);
export const documents = pgTable(
    "documents",
    {
        householdId: uuid("household_id")
            .notNull()
            .references(() => households.id, { onDelete: "cascade" }),
        id: uuid("id").notNull(),
        payload: jsonb("payload").$type<ContentDocument>().notNull(),
        importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
    },
    (t) => [primaryKey({ columns: [t.householdId, t.id] })],
);
export const referenceSources = pgTable("reference_sources", {
    householdId: uuid("household_id")
        .primaryKey()
        .references(() => households.id, { onDelete: "cascade" }),
    metadata: jsonb("metadata").$type<Omit<MoodboardSnapshot, "references">>().notNull(),
});
export const visualReferences = pgTable(
    "visual_references",
    {
        householdId: uuid("household_id")
            .notNull()
            .references(() => households.id, { onDelete: "cascade" }),
        id: text("id").notNull(),
        payload: jsonb("payload").$type<MoodboardSnapshot["references"][number]>().notNull(),
    },
    (t) => [primaryKey({ columns: [t.householdId, t.id] })],
);
export const feedback = pgTable(
    "feedback",
    {
        householdId: uuid("household_id")
            .notNull()
            .references(() => households.id, { onDelete: "cascade" }),
        id: uuid("id").notNull(),
        operationId: uuid("operation_id").notNull(),
        userId: uuid("user_id").references(() => users.id),
        fingerprint: text("fingerprint").notNull(),
        kind: text("kind", { enum: ["comment", "note"] }).notNull(),
        displayAuthor: text("display_author", {
            enum: ["Persona A", "Persona B", "Agente"],
        }).notNull(),
        title: text("title").notNull(),
        body: text("body").notNull(),
        targetKind: text("target_kind"),
        targetId: text("target_id"),
        contextUrl: text("context_url").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        primaryKey({ columns: [t.householdId, t.id] }),
        unique("feedback_operation").on(t.householdId, t.operationId),
        check("feedback_kind", sql`${t.kind} IN ('comment', 'note')`),
        check("feedback_author", sql`${t.displayAuthor} IN ('Persona A', 'Persona B', 'Agente')`),
        check(
            "feedback_target",
            sql`(${t.kind} = 'note' AND ${t.targetKind} IS NULL AND ${t.targetId} IS NULL) OR (${t.kind} = 'comment' AND ${t.targetKind} IN ('shopping', 'collection', 'document', 'moodboard', 'note') AND ${t.targetId} IS NOT NULL)`,
        ),
        index("feedback_target_idx").on(t.householdId, t.targetKind, t.targetId),
    ],
);

export const agentRuns = pgTable(
    "agent_runs",
    {
        householdId: uuid("household_id")
            .notNull()
            .references(() => households.id, { onDelete: "cascade" }),
        id: uuid("id").notNull(),
        operationId: uuid("operation_id").notNull(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id),
        fingerprint: text("fingerprint").notNull(),
        context: jsonb("context")
            .$type<import("../agent/agent.schema.ts").AgentContext>()
            .notNull(),
        status: text("status", { enum: ["queued", "running", "succeeded", "failed", "canceled"] })
            .notNull()
            .default("queued"),
        progress: text("progress", { enum: ["queued", "planning", "review", "failed", "canceled"] })
            .notNull()
            .default("queued"),
        attempts: integer("attempts").notNull().default(0),
        availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
        leaseToken: uuid("lease_token"),
        leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
        proposal: jsonb("proposal").$type<import("../agent/agent.schema.ts").AgentProposal>(),
        decision: text("decision", { enum: ["pending", "applied", "dismissed"] })
            .notNull()
            .default("pending"),
        noteId: uuid("note_id"),
        issue: text("issue", { enum: ["provider_failed", "attempts_exhausted", "access_revoked"] }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        primaryKey({ columns: [t.householdId, t.id] }),
        unique("agent_operation").on(t.householdId, t.operationId),
        index("agent_claim_idx").on(t.status, t.createdAt),
        index("agent_household_created_idx").on(t.householdId, t.createdAt),
        check(
            "agent_status",
            sql`${t.status} IN ('queued','running','succeeded','failed','canceled')`,
        ),
        check(
            "agent_progress",
            sql`${t.progress} IN ('queued','planning','review','failed','canceled')`,
        ),
        check("agent_decision", sql`${t.decision} IN ('pending','applied','dismissed')`),
        check("agent_attempts", sql`${t.attempts} BETWEEN 0 AND 3`),
        check(
            "agent_lease",
            sql`(${t.status} = 'running' AND ${t.leaseToken} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL) OR (${t.status} <> 'running' AND ${t.leaseToken} IS NULL AND ${t.leaseExpiresAt} IS NULL)`,
        ),
    ],
);
