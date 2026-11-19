import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { contentSnapshotSchema, type ContentSnapshot } from "./content.schema.ts";

export interface ContentStore {
    load(): Promise<ContentSnapshot | null>;
    save(snapshot: ContentSnapshot): Promise<void>;
}
export class ContentRepository implements ContentStore {
    constructor(
        private readonly path: string,
        private readonly rootPageId: string,
    ) {}
    async load(): Promise<ContentSnapshot | null> {
        try {
            const snapshot = contentSnapshotSchema.parse(
                JSON.parse(await readFile(this.path, "utf8")),
            );
            return snapshot.rootPageId === this.rootPageId ? snapshot : null;
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
            throw error;
        }
    }
    async save(snapshot: ContentSnapshot): Promise<void> {
        const parsed = contentSnapshotSchema.parse(snapshot);
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, JSON.stringify(parsed), { mode: 0o600 });
            await rename(temporary, this.path);
        } finally {
            await unlink(temporary).catch(() => {});
        }
    }
}
