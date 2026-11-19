import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
    feedbackJournalSchema,
    feedbackSnapshotSchema,
    type FeedbackJournal,
    type FeedbackSnapshot,
} from "./feedback.schema.ts";

export interface FeedbackStore {
    loadSnapshot(): Promise<FeedbackSnapshot | null>;
    saveSnapshot(snapshot: FeedbackSnapshot): Promise<void>;
    loadJournal(): Promise<FeedbackJournal | null>;
    saveJournal(journal: FeedbackJournal): Promise<void>;
}

async function readJson(path: string): Promise<unknown | null> {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
        throw error;
    }
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        const file = await open(temporary, "wx", 0o600);
        try {
            await file.writeFile(JSON.stringify(value));
            await file.sync();
        } finally {
            await file.close();
        }
        await rename(temporary, path);
        const directory = await open(dirname(path), "r");
        try {
            await directory.sync();
        } finally {
            await directory.close();
        }
    } finally {
        await unlink(temporary).catch(() => {});
    }
}

export class FeedbackRepository implements FeedbackStore {
    constructor(
        private readonly snapshotPath: string,
        private readonly journalPath: string,
        private readonly dataSourceId: string,
    ) {}
    async loadSnapshot(): Promise<FeedbackSnapshot | null> {
        const raw = await readJson(this.snapshotPath);
        if (raw === null) return null;
        const snapshot = feedbackSnapshotSchema.parse(raw);
        return snapshot.dataSourceId === this.dataSourceId ? snapshot : null;
    }
    saveSnapshot(snapshot: FeedbackSnapshot): Promise<void> {
        return writeAtomic(this.snapshotPath, feedbackSnapshotSchema.parse(snapshot));
    }
    async loadJournal(): Promise<FeedbackJournal | null> {
        const raw = await readJson(this.journalPath);
        if (raw === null) return null;
        const journal = feedbackJournalSchema.parse(raw);
        if (journal.dataSourceId !== this.dataSourceId)
            throw new Error("Feedback journal belongs to a different source");
        return journal;
    }
    saveJournal(journal: FeedbackJournal): Promise<void> {
        return writeAtomic(this.journalPath, feedbackJournalSchema.parse(journal));
    }
}
