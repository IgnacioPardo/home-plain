import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { HomeDatabase } from "./connection.ts";
import * as t from "./schema.ts";
import { snapshotSchema } from "../shopping/shopping.schema.ts";
import { collectionSnapshotSchema } from "../collection/collection.schema.ts";
import { contentSnapshotSchema } from "../content/content.schema.ts";
import { moodboardSnapshotSchema, type MoodboardSnapshot } from "../moodboard/moodboard.schema.ts";
import { feedbackSnapshotSchema } from "../feedback/feedback.schema.ts";

export const importBundleSchema = z
    .strictObject({
        shopping: snapshotSchema.optional(),
        collection: collectionSnapshotSchema.optional(),
        content: contentSnapshotSchema.optional(),
        moodboard: moodboardSnapshotSchema.optional(),
        feedback: feedbackSnapshotSchema.optional(),
    })
    .superRefine((bundle, ctx) => {
        const items = bundle.shopping?.items ?? [];
        if (new Set(items.map((item) => item.id)).size !== items.length)
            ctx.addIssue({ code: "custom", message: "Duplicate shopping IDs" });
        if (!Object.values(bundle).some(Boolean))
            ctx.addIssue({ code: "custom", message: "An import needs at least one collection" });
    });

/** One-time additive migration. Existing database rows (including user edits) always win. */
export async function importHome(db: HomeDatabase, householdId: string, input: unknown) {
    z.string().uuid().parse(householdId);
    const bundle = importBundleSchema.parse(input);
    return db.transaction(async (tx) => {
        const [home] = await tx
            .select()
            .from(t.households)
            .where(eq(t.households.id, householdId))
            .for("update");
        if (!home) throw new Error("Create the destination household before importing.");
        const imported = { shopping: 0, collection: 0, documents: 0, references: 0, feedback: 0 };
        for (const item of bundle.shopping?.items ?? []) {
            await tx.insert(t.rooms).values({ householdId, name: item.room }).onConflictDoNothing();
            imported.shopping += (
                await tx
                    .insert(t.shoppingItems)
                    .values({ ...item, householdId, version: item.version ?? 0 })
                    .onConflictDoNothing()
                    .returning({ id: t.shoppingItems.id })
            ).length;
        }
        for (const entry of bundle.collection?.entries ?? [])
            imported.collection += (
                await tx
                    .insert(t.collectionEntries)
                    .values({
                        householdId,
                        id: entry.id,
                        payload: entry,
                        importedAt: new Date(bundle.collection!.importedAt),
                    })
                    .onConflictDoNothing()
                    .returning({ id: t.collectionEntries.id })
            ).length;
        if (bundle.collection) {
            // Separate valid bundles can conflict with the retained destination records.
            // The household lock serializes imports; a failed merged validation rolls back all inserts.
            const rows = await tx
                .select({ payload: t.collectionEntries.payload })
                .from(t.collectionEntries)
                .where(eq(t.collectionEntries.householdId, householdId));
            collectionSnapshotSchema.parse({
                ...bundle.collection,
                entries: rows.map((row) => row.payload),
            });
        }
        for (const document of bundle.content?.documents ?? [])
            imported.documents += (
                await tx
                    .insert(t.documents)
                    .values({
                        householdId,
                        id: document.id,
                        payload: document,
                        importedAt: new Date(bundle.content!.syncedAt),
                    })
                    .onConflictDoNothing()
                    .returning({ id: t.documents.id })
            ).length;
        if (bundle.moodboard) {
            const { references, ...metadata } = bundle.moodboard;
            const [existing] = await tx
                .select()
                .from(t.referenceSources)
                .where(eq(t.referenceSources.householdId, householdId));
            const retained = existing
                ? await tx
                      .select({ payload: t.visualReferences.payload })
                      .from(t.visualReferences)
                      .where(eq(t.visualReferences.householdId, householdId))
                : [];
            const collections = new Map(
                existing
                    ? referenceCollections({
                          ...existing.metadata,
                          references: retained.map((row) => row.payload),
                      }).map((collection) => [collection.id, collection])
                    : [],
            );
            for (const collection of referenceCollections(bundle.moodboard))
                if (!collections.has(collection.id)) collections.set(collection.id, collection);
            const merged = {
                ...(existing?.metadata ?? metadata),
                collections: [...collections.values()],
            };
            await tx
                .insert(t.referenceSources)
                .values({ householdId, metadata: merged })
                .onConflictDoUpdate({
                    target: t.referenceSources.householdId,
                    set: { metadata: merged },
                });
            for (const reference of references)
                imported.references += (
                    await tx
                        .insert(t.visualReferences)
                        .values({ householdId, id: reference.id, payload: reference })
                        .onConflictDoNothing()
                        .returning({ id: t.visualReferences.id })
                ).length;
        }
        for (const entry of bundle.feedback?.entries ?? [])
            imported.feedback += (
                await tx
                    .insert(t.feedback)
                    .values({
                        ...entry,
                        householdId,
                        userId: null,
                        fingerprint: "imported",
                        targetKind: entry.target?.kind ?? null,
                        targetId: entry.target?.id ?? null,
                        createdAt: new Date(entry.createdAt),
                    })
                    .onConflictDoNothing()
                    .returning({ id: t.feedback.id })
            ).length;
        return imported;
    });
}
function referenceCollections(snapshot: MoodboardSnapshot) {
    const collections = new Map(
        (snapshot.collections ?? []).map((collection) => [collection.id, collection]),
    );
    for (const reference of snapshot.references) {
        const id = reference.collection ?? "atlas";
        if (!collections.has(id))
            collections.set(id, {
                id,
                title: snapshot.source.title,
                url: snapshot.source.url,
                importedAt: snapshot.importedAt,
            });
    }
    return [...collections.values()];
}
const bootstrapSchema = z
    .strictObject({
        id: z.string().uuid(),
        name: z.string().trim().min(1),
        accounts: z
            .array(
                z.strictObject({
                    username: z.string().trim().min(1).max(64),
                    role: z.enum(["owner", "commenter"]),
                    passwordHash: z
                        .string()
                        .regex(/^scrypt\$131072\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/),
                }),
            )
            .min(1),
    })
    .superRefine((value, ctx) => {
        if (
            new Set(value.accounts.map((account) => account.username)).size !==
                value.accounts.length ||
            !value.accounts.some((account) => account.role === "owner")
        )
            ctx.addIssue({
                code: "custom",
                message: "Use unique usernames and at least one owner",
            });
    });
/** Bootstrap is explicit and repeatable; never resets an existing account or membership. */
export async function bootstrapHousehold(db: HomeDatabase, input: z.infer<typeof bootstrapSchema>) {
    const config = bootstrapSchema.parse(input);
    await db.transaction(async (tx) => {
        await tx
            .insert(t.households)
            .values({ id: config.id, name: config.name })
            .onConflictDoNothing();
        await tx.select().from(t.households).where(eq(t.households.id, config.id)).for("update");
        for (const account of config.accounts) {
            const [created] = await tx
                .insert(t.users)
                .values({
                    id: randomUUID(),
                    username: account.username,
                    passwordHash: account.passwordHash,
                })
                .onConflictDoNothing()
                .returning();
            if (created) {
                await tx
                    .insert(t.memberships)
                    .values({ userId: created.id, householdId: config.id, role: account.role });
            } else {
                const [existing] = await tx
                    .select()
                    .from(t.users)
                    .innerJoin(t.memberships, eq(t.users.id, t.memberships.userId))
                    .where(
                        and(
                            eq(t.users.username, account.username),
                            eq(t.memberships.householdId, config.id),
                        ),
                    );
                if (
                    !existing ||
                    existing.users.passwordHash !== account.passwordHash ||
                    existing.memberships.role !== account.role
                )
                    throw new Error(
                        "Existing account configuration differs. Bootstrap does not reset credentials or move users.",
                    );
            }
        }
    });
}
