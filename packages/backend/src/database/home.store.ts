import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { HomeDatabase } from "./connection.ts";
import * as tables from "./schema.ts";
import type { AuthSession } from "../auth/auth.schema.ts";
import {
    shoppingItemSchema,
    type SetPurchased,
    type ShoppingDashboard,
} from "../shopping/shopping.schema.ts";
import { collectionSnapshotSchema } from "../collection/collection.schema.ts";
import {
    contentDocumentSchema,
    type ContentBlock,
    type ContentIndex,
} from "../content/content.schema.ts";
import { moodboardSnapshotSchema } from "../moodboard/moodboard.schema.ts";
import {
    feedbackEntrySchema,
    type CreateFeedback,
    type FeedbackTarget,
    type FeedbackList,
} from "../feedback/feedback.schema.ts";

export type Identity = AuthSession & { userId: string; householdId: string };
export type Account = {
    userId: string;
    householdId: string;
    username: string;
    role: AuthSession["role"];
    passwordHash: string;
};
export type AccountReader = {
    findAccount(username: string): Promise<Account | null>;
    findIdentity(userId: string, householdId: string): Promise<Account | null>;
};
export class HomeError extends Error {
    constructor(readonly reason: "not_found" | "forbidden" | "conflict") {
        super(`Home operation failed (${reason})`);
    }
}
export class HomeStore implements AccountReader {
    constructor(
        readonly db: HomeDatabase,
        private readonly origin: string,
    ) {}

    async findAccount(username: string): Promise<Account | null> {
        const [account] = await this.db
            .select(accountFields)
            .from(tables.users)
            .innerJoin(tables.memberships, eq(tables.users.id, tables.memberships.userId))
            .where(eq(tables.users.username, username));
        return account ?? null;
    }
    async findIdentity(userId: string, householdId: string): Promise<Account | null> {
        const [account] = await this.db
            .select(accountFields)
            .from(tables.users)
            .innerJoin(tables.memberships, eq(tables.users.id, tables.memberships.userId))
            .where(
                and(eq(tables.users.id, userId), eq(tables.memberships.householdId, householdId)),
            );
        return account ?? null;
    }
    private async authorize(identity: Identity, owner = false) {
        const current = await this.findIdentity(identity.userId, identity.householdId);
        if (!current || (owner && current.role !== "owner")) throw new HomeError("forbidden");
        return current.householdId;
    }
    async dashboard(identity: Identity): Promise<ShoppingDashboard> {
        const householdId = await this.authorize(identity);
        const rows = await this.db
            .select()
            .from(tables.shoppingItems)
            .where(eq(tables.shoppingItems.householdId, householdId))
            .orderBy(asc(tables.shoppingItems.name), asc(tables.shoppingItems.id));
        return {
            configured: true,
            state: "live",
            issue: null,
            snapshot: {
                version: 1,
                dataSourceId: householdId,
                source: "database",
                syncedAt: new Date().toISOString(),
                items: rows.map((row) => shoppingItemSchema.parse(row)),
            },
        };
    }
    async setPurchased(identity: Identity, input: SetPurchased) {
        const householdId = await this.authorize(identity, true);
        const [updated] = await this.db
            .update(tables.shoppingItems)
            .set({
                status: input.purchased ? "Comprado" : "En lista",
                version: sql`${tables.shoppingItems.version} + 1`,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(tables.shoppingItems.householdId, householdId),
                    eq(tables.shoppingItems.id, input.id),
                    eq(tables.shoppingItems.version, input.expectedVersion),
                    eq(tables.shoppingItems.status, input.expectedStatus),
                ),
            )
            .returning({ id: tables.shoppingItems.id });
        if (!updated) {
            const [existing] = await this.db
                .select({ id: tables.shoppingItems.id })
                .from(tables.shoppingItems)
                .where(
                    and(
                        eq(tables.shoppingItems.householdId, householdId),
                        eq(tables.shoppingItems.id, input.id),
                    ),
                );
            throw new HomeError(existing ? "conflict" : "not_found");
        }
        return this.dashboard(identity);
    }
    async collection(identity: Identity) {
        const householdId = await this.authorize(identity);
        const rows = await this.db
            .select()
            .from(tables.collectionEntries)
            .where(eq(tables.collectionEntries.householdId, householdId))
            .orderBy(asc(tables.collectionEntries.id));
        if (!rows.length) return null;
        return collectionSnapshotSchema.parse({
            version: 2,
            source: "import",
            importedAt: latest(rows.map((row) => row.importedAt)),
            entries: rows.map((row) => row.payload),
        });
    }
    async collectionStatus(identity: Identity) {
        const collection = await this.collection(identity);
        return {
            state: collection ? ("ready" as const) : ("missing" as const),
            importedAt: collection?.importedAt ?? null,
            issue: null,
        };
    }
    async contentIndex(identity: Identity): Promise<ContentIndex> {
        const householdId = await this.authorize(identity);
        const rows = await this.db
            .select()
            .from(tables.documents)
            .where(eq(tables.documents.householdId, householdId))
            .orderBy(asc(tables.documents.id));
        return {
            configured: true,
            state: "live",
            syncedAt: rows.length ? latest(rows.map((row) => row.importedAt)) : null,
            documents: rows.map(({ payload }) => {
                const document = contentDocumentSchema.parse(payload);
                return {
                    id: document.id,
                    parentId: document.parentId,
                    title: document.title,
                    searchText: `${document.title} ${blockText(document.blocks)}`,
                };
            }),
        };
    }
    async document(identity: Identity, id: string) {
        const householdId = await this.authorize(identity);
        const [row] = await this.db
            .select()
            .from(tables.documents)
            .where(and(eq(tables.documents.householdId, householdId), eq(tables.documents.id, id)));
        if (!row) throw new HomeError("not_found");
        return {
            configured: true,
            state: "live" as const,
            syncedAt: row.importedAt.toISOString(),
            document: contentDocumentSchema.parse(row.payload),
        };
    }
    async moodboard(identity: Identity) {
        const householdId = await this.authorize(identity);
        const [source] = await this.db
            .select()
            .from(tables.referenceSources)
            .where(eq(tables.referenceSources.householdId, householdId));
        if (!source) return null;
        const rows = await this.db
            .select()
            .from(tables.visualReferences)
            .where(eq(tables.visualReferences.householdId, householdId))
            .orderBy(asc(tables.visualReferences.id));
        return moodboardSnapshotSchema.parse({
            ...source.metadata,
            references: rows.map((row) => row.payload),
        });
    }
    async listFeedback(identity: Identity, target: FeedbackTarget | null): Promise<FeedbackList> {
        const householdId = await this.authorize(identity);
        if (target && !(await this.targetExists(householdId, target)))
            throw new HomeError("not_found");
        const rows = await this.db
            .select()
            .from(tables.feedback)
            .where(
                and(
                    eq(tables.feedback.householdId, householdId),
                    target
                        ? and(
                              eq(tables.feedback.targetKind, target.kind),
                              eq(tables.feedback.targetId, target.id),
                          )
                        : isNull(tables.feedback.targetId),
                ),
            )
            .orderBy(desc(tables.feedback.createdAt), asc(tables.feedback.id));
        return {
            configured: true,
            canCreate: true,
            state: "live",
            issue: null,
            snapshot: { syncedAt: new Date().toISOString(), entries: rows.map(feedbackEntry) },
        };
    }
    async createFeedback(identity: Identity, input: CreateFeedback) {
        const householdId = await this.authorize(identity);
        if (input.target && !(await this.targetExists(householdId, input.target)))
            throw new HomeError("not_found");
        const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        const id = randomUUID();
        await this.db
            .insert(tables.feedback)
            .values({
                householdId,
                id,
                operationId: input.operationId,
                userId: identity.userId,
                fingerprint,
                kind: input.kind,
                displayAuthor: input.displayAuthor,
                title: input.title || "Comentario",
                body: input.body,
                targetKind: input.target?.kind ?? null,
                targetId: input.target?.id ?? null,
                contextUrl: new URL(
                    input.target ? contextPath(input.target) : `/notas#nota-${id}`,
                    this.origin,
                ).href,
            })
            .onConflictDoNothing({
                target: [tables.feedback.householdId, tables.feedback.operationId],
            });
        const [saved] = await this.db
            .select()
            .from(tables.feedback)
            .where(
                and(
                    eq(tables.feedback.householdId, householdId),
                    eq(tables.feedback.operationId, input.operationId),
                ),
            );
        if (!saved || saved.userId !== identity.userId || saved.fingerprint !== fingerprint)
            throw new HomeError("conflict");
        return { status: "saved" as const, entry: feedbackEntry(saved) };
    }
    private async targetExists(householdId: string, target: FeedbackTarget) {
        const table = {
            shopping: tables.shoppingItems,
            collection: tables.collectionEntries,
            document: tables.documents,
            moodboard: tables.visualReferences,
            note: tables.feedback,
        }[target.kind];
        if (
            ["shopping", "document", "note"].includes(target.kind) &&
            !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(target.id)
        )
            return false;
        const [row] = await this.db
            .select({ id: table.id })
            .from(table)
            .where(
                and(
                    eq(table.householdId, householdId),
                    eq(table.id, target.id),
                    target.kind === "note" ? eq(tables.feedback.kind, "note") : undefined,
                ),
            );
        return Boolean(row);
    }
    async hasMedia(identity: Identity, name: string) {
        const path = `/media/${name}`;
        const collection = await this.collection(identity);
        if (collection?.entries.some((entry) => entry.images.some((image) => image.path === path)))
            return true;
        const moodboard = await this.moodboard(identity);
        return Boolean(
            moodboard?.references.some((ref) => ref.image === path || ref.thumbnail === path),
        );
    }
}
const accountFields = {
    userId: tables.users.id,
    username: tables.users.username,
    passwordHash: tables.users.passwordHash,
    householdId: tables.memberships.householdId,
    role: tables.memberships.role,
};
function latest(dates: Date[]) {
    return new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString();
}
function feedbackEntry(row: typeof tables.feedback.$inferSelect) {
    return feedbackEntrySchema.parse({
        ...row,
        createdAt: row.createdAt.toISOString(),
        target: row.targetKind ? { kind: row.targetKind, id: row.targetId } : null,
    });
}
function contextPath(target: FeedbackTarget) {
    return {
        shopping: `/lista#compra-${target.id}`,
        collection: `/coleccion#objeto-${target.id}`,
        document: `/documentos/${target.id}`,
        moodboard: `/referencias#referencia-${target.id}`,
        note: `/notas#nota-${target.id}`,
    }[target.kind];
}
function blockText(blocks: ContentBlock[]): string {
    return blocks
        .map((block) =>
            [
                block.text.map((part) => part.text).join(""),
                ...block.cells.map((cell) => cell.map((part) => part.text).join("")),
                blockText(block.children),
            ].join(" "),
        )
        .join(" ");
}
