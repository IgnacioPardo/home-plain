import { createHash } from "node:crypto";
import type { FeedbackAdapter } from "./feedback.client.ts";
import { FeedbackError } from "./feedback.errors.ts";
import type { FeedbackStore } from "./feedback.repository.ts";
import {
    createFeedbackSchema,
    feedbackSnapshotSchema,
    type CreateFeedback,
    type FeedbackCreateResult,
    type FeedbackEntry,
    type FeedbackJournal,
    type FeedbackList,
    type FeedbackReceipt,
    type FeedbackSnapshot,
    type FeedbackTarget,
} from "./feedback.schema.ts";

export class FeedbackService {
    private snapshot: FeedbackSnapshot | null = null;
    private journal: FeedbackJournal;
    private journalReady = false;
    private issue: FeedbackList["issue"] = null;
    private lastAttempt = -Infinity;
    private inFlight: Promise<void> | null = null;
    private operations: Promise<void> = Promise.resolve();
    constructor(
        private readonly config: { dataSourceId: string; origin: string; intervalMs: number },
        private readonly store: FeedbackStore,
        private readonly notion: FeedbackAdapter | null,
        private readonly targetPath: (
            target: FeedbackTarget,
        ) => string | null | Promise<string | null>,
        private readonly now = () => Date.now(),
    ) {
        this.journal = { version: 1, dataSourceId: config.dataSourceId, receipts: [] };
    }
    async initialize(): Promise<void> {
        try {
            this.snapshot = await this.store.loadSnapshot();
        } catch {
            this.issue = "cache_unavailable";
        }
        try {
            this.journal = (await this.store.loadJournal()) ?? this.journal;
            await this.store.saveJournal(this.journal);
            this.journalReady = true;
        } catch {
            this.issue = "journal_unavailable";
        }
    }
    read(target: FeedbackTarget | null): FeedbackList {
        const configured = this.notion !== null;
        const stale =
            this.snapshot !== null &&
            this.now() - Date.parse(this.snapshot.syncedAt) > this.config.intervalMs * 2;
        const issue = !configured
            ? "not_configured"
            : !this.journalReady
              ? "journal_unavailable"
              : this.issue;
        const entries = this.snapshot?.entries.filter((entry) =>
            target
                ? entry.kind === "comment" &&
                  entry.target?.kind === target.kind &&
                  entry.target.id === target.id
                : entry.kind === "note",
        );
        return {
            configured,
            canCreate: configured && this.journalReady && this.snapshot !== null,
            state: !configured
                ? this.snapshot
                    ? "offline"
                    : "unconfigured"
                : !this.snapshot && this.inFlight && !issue
                  ? "syncing"
                  : issue || stale
                    ? this.snapshot
                        ? "stale"
                        : "error"
                    : this.snapshot
                      ? "live"
                      : "error",
            issue,
            snapshot: this.snapshot
                ? { syncedAt: this.snapshot.syncedAt, entries: entries ?? [] }
                : null,
        };
    }
    async list(target: FeedbackTarget | null): Promise<FeedbackList> {
        void this.refresh();
        if (target && !(await this.pathFor(target))) throw new FeedbackError("invalid_target");
        return this.read(target);
    }
    refresh(): Promise<void> {
        if (!this.notion) return Promise.resolve();
        if (this.inFlight) return this.inFlight;
        if (this.now() - this.lastAttempt < 15_000) return Promise.resolve();
        this.lastAttempt = this.now();
        this.inFlight = this.enqueue(async () => {
            try {
                const entries = await this.notion!.list();
                // A data-source query can lag a confirmed page create. Resolve a
                // missing saved page directly so refreshing cannot erase a save;
                // archived/deleted pages are removed after that direct check.
                for (const previous of this.snapshot?.entries ?? []) {
                    if (entries.some((entry) => entry.id === previous.id)) continue;
                    if (
                        !this.journal.receipts.some(
                            (receipt) =>
                                receipt.operationId === previous.operationId &&
                                receipt.state === "confirmed",
                        )
                    )
                        continue;
                    const current = await this.notion!.getEntry(previous.id);
                    if (current) entries.push(current);
                }
                entries.sort(
                    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
                );
                const snapshot = feedbackSnapshotSchema.parse({
                    version: 1,
                    dataSourceId: this.config.dataSourceId,
                    syncedAt: new Date(this.now()).toISOString(),
                    entries,
                });
                await this.store.saveSnapshot(snapshot);
                this.snapshot = snapshot;
                this.issue = null;
            } catch {
                this.issue = "upstream_unavailable";
            }
        }).finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }
    create(raw: CreateFeedback): Promise<FeedbackCreateResult> {
        const input = createFeedbackSchema.parse(raw);
        return this.enqueue(async () => {
            if (!this.notion) throw new FeedbackError("unconfigured");
            if (!this.journalReady) throw new FeedbackError("journal_unavailable");
            const path = input.target ? await this.pathFor(input.target) : "/notas";
            if (!path) throw new FeedbackError("invalid_target");
            if (!this.snapshot) throw new FeedbackError("unavailable");
            const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
            const receipt = this.journal.receipts.find(
                (receipt) => receipt.operationId === input.operationId,
            );
            if (receipt && receipt.fingerprint !== fingerprint)
                throw new FeedbackError("operation_conflict");
            if (receipt && receipt.state !== "rejected") return this.reconcile(input, fingerprint);
            // Also check the source before a first create, so a restored local journal
            // cannot turn the same client submission ID into another Notion page.
            const existing = await this.notion.findOperation(input.operationId);
            if (existing) return this.confirm(input, fingerprint, existing);
            await this.saveReceipt({
                operationId: input.operationId,
                fingerprint,
                state: "pending",
            });
            let entry: FeedbackEntry;
            try {
                entry = await this.notion.create(input, new URL(path, this.config.origin).href);
            } catch (error) {
                if (!(error instanceof FeedbackError) || error.reason === "uncertain") {
                    this.issue = "upstream_unavailable";
                    return this.reconcile(input, fingerprint);
                }
                // Only a definite refusal or a pre-write validation failure permits
                // another create with this same ID; pending operations never do.
                await this.saveReceipt({
                    operationId: input.operationId,
                    fingerprint,
                    state: "rejected",
                });
                throw error;
            }
            return this.confirm(input, fingerprint, entry);
        });
    }
    private async pathFor(target: FeedbackTarget): Promise<string | null> {
        if (target.kind === "note")
            return this.snapshot?.entries.some(
                (entry) => entry.id === target.id && entry.kind === "note",
            )
                ? `/notas#nota-${target.id}`
                : null;
        return this.targetPath(target);
    }
    private async reconcile(
        input: CreateFeedback,
        fingerprint: string,
    ): Promise<FeedbackCreateResult> {
        try {
            const entry = await this.notion!.findOperation(input.operationId);
            if (entry) return this.confirm(input, fingerprint, entry);
        } catch (error) {
            if (error instanceof FeedbackError && error.reason === "operation_conflict")
                throw error;
        }
        return { status: "unconfirmed", operationId: input.operationId };
    }
    private async confirm(
        input: CreateFeedback,
        fingerprint: string,
        entry: FeedbackEntry,
    ): Promise<FeedbackCreateResult> {
        if (
            entry.operationId !== input.operationId ||
            entry.body !== input.body ||
            entry.kind !== input.kind ||
            entry.displayAuthor !== input.displayAuthor ||
            entry.title !== (input.title || "Comentario") ||
            JSON.stringify(entry.target) !== JSON.stringify(input.target)
        )
            throw new FeedbackError("operation_conflict");
        const entries =
            this.snapshot?.entries.filter(
                (old) => old.id !== entry.id && old.operationId !== entry.operationId,
            ) ?? [];
        entries.push(entry);
        entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        this.snapshot = {
            version: 1,
            dataSourceId: this.config.dataSourceId,
            syncedAt: this.snapshot?.syncedAt ?? new Date(this.now()).toISOString(),
            entries,
        };
        try {
            await this.saveReceipt({
                operationId: input.operationId,
                fingerprint,
                state: "confirmed",
            });
            await this.store.saveSnapshot(this.snapshot);
        } catch {
            this.issue = "cache_unavailable";
        }
        this.lastAttempt = -Infinity;
        return { status: "saved", entry };
    }
    private async saveReceipt(receipt: FeedbackReceipt): Promise<void> {
        const next = {
            ...this.journal,
            receipts: [
                ...this.journal.receipts.filter((old) => old.operationId !== receipt.operationId),
                receipt,
            ],
        };
        try {
            await this.store.saveJournal(next);
        } catch {
            this.journalReady = false;
            this.issue = "journal_unavailable";
            throw new FeedbackError("journal_unavailable");
        }
        this.journal = next;
    }
    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.operations.then(operation);
        this.operations = result.then(
            () => {},
            () => {},
        );
        return result;
    }
}
