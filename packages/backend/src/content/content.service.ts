import { logger } from "@repo/logger";
import {
    contentSnapshotSchema,
    type ContentBlock,
    type ContentDocument,
    type ContentDocumentResult,
    type ContentIndex,
    type ContentSnapshot,
} from "./content.schema.ts";
import type { ContentStore } from "./content.repository.ts";

export interface ContentReader {
    readDocuments(): Promise<ContentDocument[]>;
}
export class ContentService {
    private snapshot: ContentSnapshot | null = null;
    private failed = false;
    private lastAttempt = -Infinity;
    private pending: Promise<void> | null = null;
    constructor(
        private readonly config: { rootPageId: string; intervalMs: number },
        private readonly store: ContentStore,
        private readonly reader: ContentReader | null,
        private readonly now = () => Date.now(),
    ) {}
    async initialize() {
        try {
            this.snapshot = await this.store.load();
        } catch {
            this.failed = true;
        }
    }
    hasDocument(id: string) {
        return this.snapshot?.documents.some((document) => document.id === id) ?? false;
    }
    readIndex(): ContentIndex {
        return {
            ...this.status(),
            documents:
                this.snapshot?.documents.map(({ id, parentId, title, blocks }) => ({
                    id,
                    parentId,
                    title,
                    searchText: `${title} ${blockText(blocks)}`,
                })) ?? [],
        };
    }
    readDocument(id: string): ContentDocumentResult {
        return {
            ...this.status(),
            document: this.snapshot?.documents.find((document) => document.id === id) ?? null,
        };
    }
    refresh(): Promise<void> {
        if (!this.reader) return Promise.resolve();
        if (this.pending) return this.pending;
        if (this.now() - this.lastAttempt < 15_000) return Promise.resolve();
        this.lastAttempt = this.now();
        this.pending = this.synchronize().finally(() => {
            this.pending = null;
        });
        return this.pending;
    }
    refreshIfDue(): Promise<void> {
        return this.now() - this.lastAttempt >= this.config.intervalMs
            ? this.refresh()
            : Promise.resolve();
    }
    private status(): Omit<ContentIndex, "documents"> {
        const stale =
            this.failed ||
            Boolean(
                this.snapshot &&
                this.now() - Date.parse(this.snapshot.syncedAt) > this.config.intervalMs * 2,
            );
        return {
            configured: this.reader !== null,
            syncedAt: this.snapshot?.syncedAt ?? null,
            state: !this.reader
                ? this.snapshot
                    ? "offline"
                    : "unconfigured"
                : !this.snapshot
                  ? this.pending
                      ? "syncing"
                      : "error"
                  : stale
                    ? "stale"
                    : "live",
        };
    }
    private async synchronize() {
        try {
            const snapshot = contentSnapshotSchema.parse({
                version: 1,
                rootPageId: this.config.rootPageId,
                syncedAt: new Date(this.now()).toISOString(),
                documents: await this.reader!.readDocuments(),
            });
            await this.store.save(snapshot);
            this.snapshot = snapshot;
            this.failed = false;
        } catch {
            this.failed = true;
            logger.warn("Home document sync failed; retaining the last complete projection");
        }
    }
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
