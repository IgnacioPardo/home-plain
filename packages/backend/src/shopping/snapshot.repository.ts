import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { snapshotSchema, type Snapshot } from "./shopping.schema.ts";

export interface SnapshotStore {
    load(): Promise<Snapshot | null>;
    save(snapshot: Snapshot): Promise<void>;
}
export class SnapshotReadError extends Error {
    constructor(cause: unknown) {
        super("Cannot read shopping snapshot", { cause });
        this.name = "SnapshotReadError";
    }
}
export class SnapshotWriteError extends Error {
    constructor(cause: unknown) {
        super("Cannot persist shopping snapshot", { cause });
        this.name = "SnapshotWriteError";
    }
}
export class SnapshotRepository implements SnapshotStore {
    constructor(
        private readonly path: string,
        private readonly dataSourceId: string,
    ) {}
    async load(): Promise<Snapshot | null> {
        try {
            const snapshot = snapshotSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
            return snapshot.dataSourceId === this.dataSourceId ? snapshot : null;
        } catch (cause) {
            if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null;
            throw new SnapshotReadError(cause);
        }
    }
    async save(snapshot: Snapshot): Promise<void> {
        try {
            const validated = snapshotSchema.parse(snapshot);
            await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
            const temporary = `${this.path}.${randomUUID()}.tmp`;
            await writeFile(temporary, JSON.stringify(validated), { mode: 0o600 });
            await rename(temporary, this.path);
        } catch (cause) {
            throw new SnapshotWriteError(cause);
        }
    }
}
