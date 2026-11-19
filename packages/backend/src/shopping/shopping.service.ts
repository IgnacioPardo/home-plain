import { logger } from "@repo/logger";
import type { NotionReader, NotionWriter } from "../notion/notion.client.ts";
import type { SetPurchased, ShoppingDashboard, ShoppingItem, Snapshot } from "./shopping.schema.ts";
import { ShoppingWriteError } from "./shopping.errors.ts";
import type { SnapshotStore } from "./snapshot.repository.ts";

const log = logger.child({ name: "shopping-sync" });
export class ShoppingService {
    private snapshot: Snapshot | null = null;
    private issue: ShoppingDashboard["issue"] = null;
    private inFlight: Promise<ShoppingDashboard> | null = null;
    private lastAttempt = -Infinity;
    private operations: Promise<void> = Promise.resolve();
    constructor(
        private readonly config: { dataSourceId: string; intervalMs: number },
        private readonly store: SnapshotStore,
        private readonly notion: (NotionReader & Partial<NotionWriter>) | null,
        private readonly now = () => Date.now(),
    ) {}

    async initialize(): Promise<void> {
        try {
            this.snapshot = await this.store.load();
        } catch {
            this.issue = "cache_unavailable";
            log.warn("Shopping cache is unreadable; a successful sync will replace it");
        }
    }
    read(): ShoppingDashboard {
        const configured = this.notion !== null;
        const outdated =
            this.snapshot !== null &&
            this.now() - Date.parse(this.snapshot.syncedAt) > this.config.intervalMs * 2;
        return {
            configured,
            snapshot: this.snapshot,
            state: !configured
                ? this.snapshot
                    ? "offline"
                    : "unconfigured"
                : !this.snapshot && this.inFlight
                  ? "syncing"
                  : this.issue
                    ? this.snapshot
                        ? "stale"
                        : "error"
                    : !this.snapshot
                      ? "error"
                      : outdated
                        ? "stale"
                        : "live",
            issue: !configured ? "not_configured" : this.issue,
        };
    }
    refresh(): Promise<ShoppingDashboard> {
        if (!this.notion) return Promise.resolve(this.read());
        if (this.inFlight) return this.inFlight;
        if (this.now() - this.lastAttempt < 15_000) return Promise.resolve(this.read());
        this.lastAttempt = this.now();
        this.inFlight = this.enqueue(() => this.synchronize()).finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }
    setPurchased(input: SetPurchased): Promise<ShoppingDashboard> {
        return this.enqueue(async () => {
            if (!this.notion?.setPurchased) throw new ShoppingWriteError("unconfigured");
            const item = this.snapshot?.items.find((row) => row.id.toLowerCase() === input.id);
            if (!item) throw new ShoppingWriteError("not_found");
            if (item.status !== input.expectedStatus) throw new ShoppingWriteError("conflict");
            let updated: ShoppingItem;
            try {
                updated = await this.notion.setPurchased(input);
            } catch (error) {
                // Let the next refresh reconcile conflicts or uncertain remote outcomes
                // immediately, even when a periodic sync just ran.
                this.lastAttempt = -Infinity;
                if (error instanceof ShoppingWriteError && error.currentItem) {
                    await this.publishConfirmedItem(error.currentItem);
                    if (error.reason === "uncertain") this.issue = "upstream_unavailable";
                } else {
                    this.issue = "upstream_unavailable";
                }
                throw error instanceof ShoppingWriteError
                    ? error
                    : new ShoppingWriteError("unavailable");
            }
            await this.publishConfirmedItem(updated);
            return this.read();
        });
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.operations.then(operation);
        this.operations = result.then(
            () => {},
            () => {},
        );
        return result;
    }

    private async publishConfirmedItem(item: ShoppingItem): Promise<void> {
        // A confirmed remote change must remain visible even if the local cache
        // cannot be saved. Keep the timestamp of the last complete source read.
        this.snapshot = {
            ...this.snapshot!,
            items: this.snapshot!.items.map((row) =>
                row.id.toLowerCase() === item.id.toLowerCase() ? item : row,
            ),
        };
        try {
            await this.store.save(this.snapshot);
            if (this.issue === "cache_unavailable") this.issue = null;
        } catch {
            this.issue = "cache_unavailable";
            log.warn("Notion update confirmed; shopping cache could not be saved");
        }
    }

    private async synchronize(): Promise<ShoppingDashboard> {
        try {
            const items = await this.notion!.listShopping();
            const snapshot: Snapshot = {
                version: 1,
                dataSourceId: this.config.dataSourceId,
                syncedAt: new Date(this.now()).toISOString(),
                source: "api",
                items,
            };
            await this.store.save(snapshot);
            this.snapshot = snapshot;
            this.issue = null;
            log.info("Shopping projection synchronized", { itemCount: items.length });
        } catch {
            this.issue = "upstream_unavailable";
            log.warn("Shopping sync failed; retaining the last complete snapshot");
        }
        return this.read();
    }
}
