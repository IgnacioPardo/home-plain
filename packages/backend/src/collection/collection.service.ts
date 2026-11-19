import type { CollectionRepository } from "./collection.repository.ts";
import {
    collectionSnapshotSchema,
    type CollectionSnapshot,
    type CollectionSnapshotInput,
    type CollectionStatus,
} from "./collection.schema.ts";

export interface CollectionReader {
    read(): Promise<CollectionSnapshot | null>;
    status(): Promise<CollectionStatus>;
}
export type CollectionSource = CollectionSnapshotInput | CollectionReader | null;
export async function readCollection(source: CollectionSource): Promise<CollectionSnapshot | null> {
    return source && "read" in source
        ? source.read()
        : source
          ? collectionSnapshotSchema.parse(source)
          : null;
}
export async function readCollectionStatus(source: CollectionSource): Promise<CollectionStatus> {
    if (source && "status" in source) return source.status();
    const snapshot = await readCollection(source);
    return {
        state: snapshot ? "ready" : "missing",
        importedAt: snapshot?.importedAt ?? null,
        issue: null,
    };
}

/** Refreshes atomic file generations without coupling collection imports to shopping sync. */
export class CollectionService implements CollectionReader {
    private snapshot: CollectionSnapshot | null = null;
    private revision: string | null = null;
    private currentStatus: CollectionStatus = { state: "missing", importedAt: null, issue: null };
    private pending: Promise<void> | null = null;
    constructor(private readonly repository: CollectionRepository) {}

    async read(): Promise<CollectionSnapshot | null> {
        await this.refresh();
        return this.snapshot;
    }
    async status(): Promise<CollectionStatus> {
        await this.refresh();
        return this.currentStatus;
    }
    private refresh(): Promise<void> {
        if (this.pending) return this.pending;
        this.pending = this.reload().finally(() => {
            this.pending = null;
        });
        return this.pending;
    }
    private async reload(): Promise<void> {
        try {
            const generation = await this.repository.readGeneration(this.revision);
            if (generation === null) {
                if (this.snapshot)
                    this.currentStatus = {
                        state: "ready",
                        importedAt: this.snapshot.importedAt,
                        issue: null,
                    };
                return;
            }
            this.snapshot = generation.snapshot;
            this.revision = generation.revision;
            this.currentStatus = {
                state: "ready",
                importedAt: this.snapshot.importedAt,
                issue: null,
            };
        } catch {
            // Do not cache failed revisions: an interrupted publication can recover on the next read.
            this.currentStatus = {
                state: this.snapshot ? "stale" : "missing",
                importedAt: this.snapshot?.importedAt ?? null,
                issue: "No se pudo leer la importación del catálogo.",
            };
        }
    }
}
