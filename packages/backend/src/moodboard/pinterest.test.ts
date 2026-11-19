import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { importPinterestReferences } from "./pinterest.import.ts";
import { MoodboardRepository, MoodboardService } from "./moodboard.repository.ts";

const reference = {
    id: "a123456789abcd",
    title: "Room reference",
    projectKey: "https://example.com/room",
    source: "https://example.com/room",
    publisher: "Publisher",
    styles: [],
    rooms: ["Living"],
    objects: ["Iluminación"],
    note: "A proposed reference.",
    quality: "editorial",
    palette: [],
    hero: true,
};
const snapshot = {
    version: 1,
    importedAt: "2026-11-12T14:00:00.000Z",
    status: "exploratory",
    source: {
        title: "Original atlas",
        url: "https://example.com/atlas",
        conversation: "https://example.com/chat",
        sha256: "a".repeat(64),
    },
    references: [{ ...reference, image: null, thumbnail: null }],
};

it("imports Pinterest repeatably without replacing atlas IDs and reloads completed generations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-pinterest-"));
    const options = {
        selectionPath: join(directory, "selection.json"),
        imagesDirectory: directory,
        mediaDirectory: join(directory, "media"),
        snapshotPath: join(directory, "snapshot.json"),
        now: new Date("2026-11-18T14:00:00Z"),
    };
    try {
        await writeFile(options.snapshotPath, JSON.stringify(snapshot));
        const service = new MoodboardService(new MoodboardRepository(options.snapshotPath));
        await service.initialize();
        expect(service.current()?.references).toHaveLength(1);
        const pin = {
            ...reference,
            id: "b123456789abcd",
            source: "https://www.pinterest.com/pin/123/",
        };
        await writeFile(
            options.selectionPath,
            JSON.stringify({
                title: "Pinterest",
                url: "https://example.com/research",
                references: [pin],
            }),
        );
        await writeFile(
            join(directory, `${pin.id}.jpg`),
            Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]),
        );
        const first = await importPinterestReferences(options);
        const second = await importPinterestReferences(options);
        expect(second).toEqual(first);
        expect(first.references.map((ref) => ref.id)).toEqual([pin.id, reference.id]);
        expect(first.collections?.map((collection) => collection.id)).toEqual([
            "atlas",
            "pinterest",
        ]);
        expect((await service.read())?.references).toHaveLength(2);
        const saved = await readFile(options.snapshotPath, "utf8");
        await writeFile(join(directory, `${pin.id}.jpg`), "upstream error");
        await expect(importPinterestReferences(options)).rejects.toThrow("JPEG");
        expect(await readFile(options.snapshotPath, "utf8")).toBe(saved);
        await writeFile(options.snapshotPath, "partial generation");
        expect(await service.read()).toEqual(first);
        await writeFile(options.snapshotPath, saved);
        expect(await service.read()).toEqual(first);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it("rejects a colliding reference ID or missing original atlas without publishing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-pinterest-collision-"));
    const options = {
        selectionPath: join(directory, "selection.json"),
        imagesDirectory: directory,
        mediaDirectory: join(directory, "media"),
        snapshotPath: join(directory, "snapshot.json"),
        now: new Date(),
    };
    try {
        await writeFile(
            options.selectionPath,
            JSON.stringify({
                title: "Pinterest",
                url: "https://example.com/research",
                references: [reference],
            }),
        );
        await expect(importPinterestReferences(options)).rejects.toThrow();
        await writeFile(options.snapshotPath, JSON.stringify(snapshot));
        await writeFile(
            join(directory, `${reference.id}.jpg`),
            Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        );
        await expect(importPinterestReferences(options)).rejects.toThrow("Duplicate reference IDs");
        expect(JSON.parse(await readFile(options.snapshotPath, "utf8"))).toEqual(snapshot);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
