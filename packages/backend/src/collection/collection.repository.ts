import { open, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "@repo/logger";
import { collectionSnapshotSchema, type CollectionSnapshot } from "./collection.schema.ts";

/** Loads a private, source-attributed selection imported from the connected Notion workspace. */
export class CollectionRepository {
    constructor(
        private readonly path: string,
        private readonly mediaDirectory?: string,
    ) {}
    async load(): Promise<CollectionSnapshot | null> {
        try {
            return collectionSnapshotSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
        } catch (cause) {
            if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT"))
                logger.warn(
                    "Collection snapshot is unavailable; showing the shopping collection instead",
                );
            return null;
        }
    }
    async readGeneration(
        previousRevision: string | null,
    ): Promise<{ revision: string; snapshot: CollectionSnapshot } | null> {
        // Opening once pins the inode even if an owner import renames the next generation concurrently.
        const file = await open(this.path, "r");
        try {
            const info = await file.stat({ bigint: true });
            const revision = `${info.dev}:${info.ino}:${info.mtimeNs}:${info.size}`;
            if (revision === previousRevision) return null;
            if (info.size > 16_000_000n) throw new Error("Collection snapshot is too large");
            const snapshot = collectionSnapshotSchema.parse(
                JSON.parse(await file.readFile("utf8")),
            );
            if (this.mediaDirectory) {
                for (const path of new Set(
                    snapshot.entries.flatMap((entry) => entry.images.map((image) => image.path)),
                )) {
                    const media = await stat(
                        join(this.mediaDirectory, path.slice("/media/".length)),
                    );
                    if (!media.isFile() || media.size === 0)
                        throw new Error("Collection media is unavailable");
                }
            }
            return { revision, snapshot };
        } finally {
            await file.close();
        }
    }
}
