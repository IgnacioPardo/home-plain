import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FeedbackService } from "./feedback.service.ts";
import { FeedbackRepository, type FeedbackStore } from "./feedback.repository.ts";
import { FeedbackError } from "./feedback.errors.ts";
import type { FeedbackAdapter } from "./feedback.client.ts";
import {
    createFeedbackSchema,
    type CreateFeedback,
    type FeedbackEntry,
    type FeedbackJournal,
    type FeedbackSnapshot,
} from "./feedback.schema.ts";

const source = "00000000-0000-4000-8000-000000000001";
const item = "00000000-0000-4000-8000-000000000002";
const operation = "00000000-0000-4000-8000-000000000003";
const noteId = "00000000-0000-4000-8000-000000000004";
const input: CreateFeedback = {
    operationId: operation,
    kind: "note",
    displayAuthor: "Persona A",
    title: "Medidas",
    body: "Revisar la profundidad antes de elegir.",
    target: null,
};
const entry: FeedbackEntry = {
    ...input,
    id: noteId,
    contextUrl: "https://home.example/notas",
    createdAt: "2026-11-16T12:00:00Z",
};
let time = Date.parse(entry.createdAt);
function fixture() {
    let snapshot: FeedbackSnapshot | null = null;
    let journal: FeedbackJournal | null = null;
    const remote: FeedbackEntry[] = [];
    const store: FeedbackStore = {
        loadSnapshot: vi.fn(async () => structuredClone(snapshot)),
        saveSnapshot: vi.fn(async (next) => {
            snapshot = structuredClone(next);
        }),
        loadJournal: vi.fn(async () => structuredClone(journal)),
        saveJournal: vi.fn(async (next) => {
            journal = structuredClone(next);
        }),
    };
    const notion: FeedbackAdapter = {
        list: vi.fn(async () => structuredClone(remote)),
        findOperation: vi.fn(async (id) =>
            structuredClone(remote.find((row) => row.operationId === id) ?? null),
        ),
        getEntry: vi.fn(async (id) => structuredClone(remote.find((row) => row.id === id) ?? null)),
        create: vi.fn(async (value, contextUrl) => {
            const row = {
                ...value,
                title: value.title || "Comentario",
                id: noteId,
                contextUrl,
                createdAt: entry.createdAt,
            };
            remote.push(row);
            return row;
        }),
    };
    const make = (
        targetPath: (target: {
            kind: string;
            id: string;
        }) => string | null | Promise<string | null> = (target) =>
            target.kind === "shopping" && target.id === item ? "/" : null,
    ) =>
        new FeedbackService(
            { dataSourceId: source, intervalMs: 300_000, origin: "https://home.example" },
            store,
            notion,
            targetPath,
            () => time,
        );
    return { store, notion, remote, make };
}
afterEach(() => {
    time = Date.parse(entry.createdAt);
});

it("saves a standalone note and returns it after restarting from the private projection", async () => {
    const f = fixture();
    const service = f.make();
    await service.initialize();
    await service.refresh();
    expect(await service.create(input)).toEqual({ status: "saved", entry });
    const restarted = f.make();
    await restarted.initialize();
    await restarted.refresh();
    expect(restarted.read(null).snapshot?.entries).toEqual([entry]);
    expect(await restarted.create(input)).toEqual({ status: "saved", entry });
    expect(f.notion.create).toHaveBeenCalledTimes(1);
});
it("serializes repeated simultaneous submissions and rejects reused IDs with different content", async () => {
    const f = fixture();
    const service = f.make();
    await service.initialize();
    await service.refresh();
    const results = await Promise.all([service.create(input), service.create(input)]);
    expect(results.map((result) => result.status)).toEqual(["saved", "saved"]);
    expect(f.notion.create).toHaveBeenCalledTimes(1);
    await expect(service.create({ ...input, body: "Otro texto" })).rejects.toMatchObject({
        reason: "operation_conflict",
    });
    expect(f.notion.create).toHaveBeenCalledTimes(1);
});
it("reconciles a committed create whose response was lost without repeating the POST", async () => {
    const f = fixture();
    const service = f.make();
    await service.initialize();
    await service.refresh();
    vi.mocked(f.notion.create).mockImplementationOnce(async () => {
        f.remote.push(entry);
        throw new FeedbackError("uncertain");
    });
    expect(await service.create(input)).toEqual({ status: "saved", entry });
    expect(f.notion.create).toHaveBeenCalledTimes(1);
});
it("never repeats an uncertain create, including after restart and a temporarily empty source query", async () => {
    const f = fixture();
    const service = f.make();
    await service.initialize();
    await service.refresh();
    vi.mocked(f.notion.create).mockRejectedValueOnce(new FeedbackError("uncertain"));
    expect(await service.create(input)).toEqual({ status: "unconfirmed", operationId: operation });
    const restarted = f.make();
    await restarted.initialize();
    await restarted.refresh();
    expect(await restarted.create(input)).toEqual({
        status: "unconfirmed",
        operationId: operation,
    });
    expect(f.notion.create).toHaveBeenCalledTimes(1);
    f.remote.push(entry);
    expect(await restarted.create(input)).toEqual({ status: "saved", entry });
    expect(f.notion.create).toHaveBeenCalledTimes(1);
});
it("does not dispatch a write if its durable receipt cannot be stored", async () => {
    const f = fixture();
    const service = f.make();
    await service.initialize();
    await service.refresh();
    vi.mocked(f.store.saveJournal).mockRejectedValueOnce(new Error("disk full"));
    await expect(service.create(input)).rejects.toMatchObject({ reason: "journal_unavailable" });
    expect(f.notion.create).not.toHaveBeenCalled();
    expect(service.read(null).canCreate).toBe(false);
});
it("fails closed for writes when the existing operation journal is unreadable", async () => {
    const f = fixture();
    vi.mocked(f.store.loadJournal).mockRejectedValueOnce(new Error("corrupt"));
    const service = f.make();
    await service.initialize();
    await service.refresh();
    await expect(service.create(input)).rejects.toMatchObject({ reason: "journal_unavailable" });
    expect(f.notion.create).not.toHaveBeenCalled();
});
it("reports an already-confirmed save even when the follow-up journal write fails", async () => {
    const f = fixture();
    const service = f.make();
    await service.initialize();
    await service.refresh();
    const original = f.notion.create;
    vi.mocked(f.notion.create).mockImplementationOnce(async (value, url) => {
        vi.mocked(f.store.saveJournal).mockRejectedValueOnce(new Error("disk full"));
        f.remote.push(entry);
        return { ...entry, ...value, contextUrl: url };
    });
    expect((await service.create(input)).status).toBe("saved");
    expect(service.read(null).snapshot?.entries).toHaveLength(1);
    const restarted = f.make();
    await restarted.initialize();
    await restarted.refresh();
    expect((await restarted.create(input)).status).toBe("saved");
    expect(original).toHaveBeenCalledTimes(1);
});
it("allows an explicit retry after a definite refusal, while preserving the same submission ID", async () => {
    const f = fixture();
    const service = f.make();
    await service.initialize();
    await service.refresh();
    vi.mocked(f.notion.create).mockRejectedValueOnce(new FeedbackError("rejected"));
    await expect(service.create(input)).rejects.toMatchObject({ reason: "rejected" });
    expect((await service.create(input)).status).toBe("saved");
    expect(f.notion.create).toHaveBeenCalledTimes(2);
});
it("rejects arbitrary targets before contacting Notion and accepts comments on existing notes", async () => {
    const f = fixture();
    const service = f.make();
    await service.initialize();
    await service.refresh();
    await expect(
        service.create({ ...input, kind: "comment", target: { kind: "document", id: source } }),
    ).rejects.toMatchObject({ reason: "invalid_target" });
    expect(f.notion.findOperation).not.toHaveBeenCalled();
    await service.create(input);
    const comment = {
        ...input,
        operationId: "00000000-0000-4000-8000-000000000005",
        title: "",
        kind: "comment" as const,
        target: { kind: "note" as const, id: noteId },
    };
    expect((await service.create(comment)).status).toBe("saved");
    expect(f.notion.create).toHaveBeenLastCalledWith(
        comment,
        `https://home.example/notas#nota-${noteId}`,
    );
});
it("keeps the last good snapshot after incomplete/schema-drift reads or cache failures", async () => {
    const f = fixture();
    const service = f.make();
    await service.initialize();
    await service.refresh();
    f.remote.push(entry);
    time += 20_000;
    await service.refresh();
    time += 20_000;
    vi.mocked(f.notion.list).mockRejectedValueOnce(new FeedbackError("schema"));
    await service.refresh();
    expect(service.read(null)).toMatchObject({ state: "stale", snapshot: { entries: [entry] } });
    time += 20_000;
    f.remote.length = 0;
    vi.mocked(f.store.saveSnapshot).mockRejectedValueOnce(new Error("full"));
    await service.refresh();
    expect(service.read(null).snapshot?.entries).toEqual([entry]);
});
it("keeps a confirmed note when the data-source query lags, then respects confirmed deletion", async () => {
    const f = fixture();
    const service = f.make();
    await service.initialize();
    await service.refresh();
    await service.create(input);
    vi.mocked(f.notion.list).mockResolvedValueOnce([]);
    await service.refresh();
    expect(service.read(null).snapshot?.entries).toEqual([entry]);
    expect(f.notion.getEntry).toHaveBeenCalledWith(noteId);
    time += 20_000;
    f.remote.length = 0;
    await service.refresh();
    expect(service.read(null).snapshot?.entries).toEqual([]);
});
it("validates body limits, note titles, exact input fields and required comment targets", () => {
    expect(createFeedbackSchema.safeParse({ ...input, body: " " }).success).toBe(false);
    expect(createFeedbackSchema.safeParse({ ...input, body: "x".repeat(8001) }).success).toBe(
        false,
    );
    expect(createFeedbackSchema.safeParse({ ...input, title: "" }).success).toBe(false);
    expect(createFeedbackSchema.safeParse({ ...input, kind: "comment" }).success).toBe(false);
    expect(createFeedbackSchema.safeParse({ ...input, dataSourceId: source }).success).toBe(false);
});
it("persists private atomic receipts separately from replaceable content, refusing another source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-feedback-"));
    try {
        const snapshot = join(directory, "feedback.json"),
            journal = join(directory, "operations.json");
        const repository = new FeedbackRepository(snapshot, journal, source);
        const value: FeedbackJournal = {
            version: 1,
            dataSourceId: source,
            receipts: [{ operationId: operation, fingerprint: "a".repeat(64), state: "pending" }],
        };
        await repository.saveJournal(value);
        expect(await repository.loadJournal()).toEqual(value);
        expect((await stat(journal)).mode & 0o777).toBe(0o600);
        expect(await readFile(journal, "utf8")).not.toContain(input.body);
        await expect(new FeedbackRepository(snapshot, journal, item).loadJournal()).rejects.toThrow(
            "different source",
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it("returns cached or initial state immediately while an upstream refresh is pending", async () => {
    const f = fixture();
    let resolve!: (entries: FeedbackEntry[]) => void;
    vi.mocked(f.notion.list).mockReturnValueOnce(
        new Promise((done) => {
            resolve = done;
        }),
    );
    const service = f.make();
    await service.initialize();
    const initial = await service.list(null);
    expect(initial).toMatchObject({ state: "syncing", canCreate: false, snapshot: null });
    await resolve([entry]);
    await service.refresh();
    expect(service.read(null).snapshot?.entries).toEqual([entry]);
    time += 20_000;
    vi.mocked(f.notion.list).mockReturnValueOnce(
        new Promise((done) => {
            resolve = done;
        }),
    );
    expect((await service.list(null)).snapshot?.entries).toEqual([entry]);
    resolve([entry]);
    await service.refresh();
});

it("awaits current catalog membership before reading or creating feedback", async () => {
    const f = fixture();
    let exists = false;
    const service = f.make(async (target) =>
        exists && target.kind === "collection" ? `/coleccion#objeto-${target.id}` : null,
    );
    await service.initialize();
    await service.refresh();
    const target = { kind: "collection" as const, id: "new-imported-object" };
    await expect(service.list(target)).rejects.toMatchObject({ reason: "invalid_target" });
    await expect(service.create({ ...input, kind: "comment", target })).rejects.toMatchObject({
        reason: "invalid_target",
    });
    exists = true;
    expect((await service.list(target)).canCreate).toBe(true);
    expect((await service.create({ ...input, kind: "comment", target })).status).toBe("saved");
    exists = false;
    await expect(service.list(target)).rejects.toMatchObject({ reason: "invalid_target" });
});
