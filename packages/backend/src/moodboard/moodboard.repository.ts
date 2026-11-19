import { readFile } from "node:fs/promises";
import { logger } from "@repo/logger";
import { moodboardSnapshotSchema, type MoodboardSnapshot } from "./moodboard.schema.ts";

export class MoodboardRepository {
    constructor(private readonly path: string) {}
    async load(): Promise<MoodboardSnapshot | null> {
        try {
            return moodboardSnapshotSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
        } catch (cause) {
            if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT"))
                logger.warn("Moodboard import is unavailable");
            return null;
        }
    }
}

/** Reloads complete imports on reads; failed replacements retain the last good one. */
export class MoodboardService {
    private snapshot: MoodboardSnapshot | null = null;
    private pending: Promise<MoodboardSnapshot | null> | null = null;
    constructor(private readonly repository: MoodboardRepository) {}
    async initialize(): Promise<void> {
        await this.read();
    }
    current(): MoodboardSnapshot | null {
        return this.snapshot;
    }
    read(): Promise<MoodboardSnapshot | null> {
        if (!this.pending) {
            this.pending = this.repository
                .load()
                .then((snapshot) => {
                    if (snapshot) this.snapshot = snapshot;
                    return this.snapshot;
                })
                .finally(() => {
                    this.pending = null;
                });
        }
        return this.pending;
    }
}
