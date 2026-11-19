import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { importMoodboard } from "./moodboard.import.ts";
import { MoodboardRepository } from "./moodboard.repository.ts";
import { moodboardSnapshotSchema } from "./moodboard.schema.ts";

const reference = {
    id: "a123456789abcd",
    title: "An exploratory room",
    projectKey: "https://publisher.example/project",
    source: "https://publisher.example/project?view=room",
    publisher: "Original publisher",
    image: "images/a123456789abcd.jpg",
    thumb: "images/a123456789abcd-t.jpg",
    original: "https://private.example/photo.jpg?token=do-not-expose",
    styles: ["Exploratory direction"],
    rooms: [],
    objects: ["Books"],
    note: "Imported curator's interpretation, not an approved choice.",
    quality: "editorial",
    palette: ["#aabbcc"],
    hero: true,
};
const catalog = {
    title: "Example atlas",
    source: { url: "https://example.com/atlas" },
    references: [reference],
    counts: { images: 1, sources: 1, styles: 1 },
};
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]);

it("imports attributed content with local media and preserves the last good copy on failed imports", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-atlas-"));
    const options = {
        catalogPath: join(directory, "catalog.json"),
        imagesDirectory: directory,
        mediaDirectory: join(directory, "media"),
        snapshotPath: join(directory, "snapshot.json"),
        now: new Date("2026-11-12T14:00:00.000Z"),
    };
    try {
        const repository = new MoodboardRepository(options.snapshotPath);
        expect(await repository.load()).toBeNull();
        await writeFile(options.catalogPath, JSON.stringify(catalog));
        await writeFile(join(directory, `${reference.id}-t.jpg`), jpeg);
        const snapshot = await importMoodboard(options);
        expect(await repository.load()).toEqual(snapshot);
        expect(snapshot).toMatchObject({
            importedAt: options.now.toISOString(),
            status: "exploratory",
            source: { url: catalog.source.url, conversation: null },
            references: [
                {
                    title: reference.title,
                    note: reference.note,
                    rooms: [],
                    source: reference.source,
                    image: null,
                },
            ],
        });
        const thumbnail = snapshot.references[0]!.thumbnail!;
        expect(await readFile(join(options.mediaDirectory, thumbnail.split("/").at(-1)!))).toEqual(
            jpeg,
        );
        expect(JSON.stringify(snapshot)).not.toContain("do-not-expose");
        expect(snapshot.references[0]).not.toHaveProperty("original");
        const saved = await readFile(options.snapshotPath, "utf8");
        for (const broken of [
            { ...catalog, counts: { ...catalog.counts, images: 2 } },
            {
                ...catalog,
                references: [reference, reference],
                counts: { ...catalog.counts, images: 2 },
            },
            { ...catalog, references: [{ ...reference, thumb: "../private.jpg" }] },
        ]) {
            await writeFile(options.catalogPath, JSON.stringify(broken));
            await expect(importMoodboard(options)).rejects.toThrow();
            expect(await readFile(options.snapshotPath, "utf8")).toBe(saved);
        }
        await writeFile(options.catalogPath, JSON.stringify(catalog));
        await writeFile(join(directory, `${reference.id}-t.jpg`), "<html>upstream error</html>");
        await expect(importMoodboard(options)).rejects.toThrow("JPEG");
        expect(await readFile(options.snapshotPath, "utf8")).toBe(saved);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it("keeps all references when images are absent, and treats corrupt snapshots as unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-atlas-missing-"));
    try {
        const catalogPath = join(directory, "catalog.json");
        const snapshotPath = join(directory, "snapshot.json");
        await writeFile(catalogPath, JSON.stringify(catalog));
        const snapshot = await importMoodboard({
            catalogPath,
            snapshotPath,
            imagesDirectory: directory,
            mediaDirectory: join(directory, "media"),
            now: new Date(),
        });
        expect(snapshot.references).toHaveLength(1);
        expect(snapshot.references[0]).toMatchObject({ image: null, thumbnail: null });
        for (const image of [
            "https://signed.example/photo.jpg?token=secret",
            "/media/../private.jpg",
        ])
            expect(
                moodboardSnapshotSchema.safeParse({
                    ...snapshot,
                    references: [{ ...snapshot.references[0], image }],
                }).success,
            ).toBe(false);
        for (const source of ["javascript:alert(1)", "https://user:secret@example.com/project"])
            expect(
                moodboardSnapshotSchema.safeParse({
                    ...snapshot,
                    references: [{ ...snapshot.references[0], source }],
                }).success,
            ).toBe(false);
        await writeFile(snapshotPath, "invalid");
        expect(await new MoodboardRepository(snapshotPath).load()).toBeNull();
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
