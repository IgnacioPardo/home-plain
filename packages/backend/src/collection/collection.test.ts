import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CollectionRepository } from "./collection.repository.ts";
import { collectionSnapshotSchema } from "./collection.schema.ts";

const snapshot = {
    version: 1,
    source: "import",
    importedAt: "2026-11-12T11:21:08.000Z",
    entries: [
        {
            id: "test-object",
            kind: "object",
            title: "An existing object",
            subtitle: "From the inventory",
            body: "Source context",
            category: "Music",
            label: "In Inventario",
            image: "/media/object.png",
            imageAlt: "Object",
            source: { title: "Inventario", url: "https://www.notion.so/example" },
            imageSource: null,
            shoppingItemId: null,
            layout: "wide",
            tone: "paper",
        },
    ],
};
it("reads an attributed private collection and handles absent or malformed imports", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-collection-"));
    const path = join(directory, "collection.json");
    try {
        const repository = new CollectionRepository(path);
        expect(await repository.load()).toBeNull();
        await writeFile(path, JSON.stringify(snapshot));
        expect(await repository.load()).toEqual(collectionSnapshotSchema.parse(snapshot));
        await writeFile(path, "{not-json}");
        expect(await repository.load()).toBeNull();
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
it("keeps signed media URLs and executable source links out of the browser payload", () => {
    const original = snapshot.entries[0];
    expect(
        collectionSnapshotSchema.safeParse({
            ...snapshot,
            entries: [{ ...original, image: "https://signed.example/object.png?token=private" }],
        }).success,
    ).toBe(false);
    expect(
        collectionSnapshotSchema.safeParse({
            ...snapshot,
            entries: [{ ...original, image: "/media/../private.json" }],
        }).success,
    ).toBe(false);
    expect(
        collectionSnapshotSchema.safeParse({
            ...snapshot,
            entries: [{ ...original, source: { title: "Bad link", url: "javascript:alert(1)" } }],
        }).success,
    ).toBe(false);
});

it("normalizes legacy entries without inventing product metadata or exact shopping matches", () => {
    const migrated = collectionSnapshotSchema.parse({
        ...snapshot,
        entries: [
            { ...snapshot.entries[0], shoppingItemId: "00000000-0000-4000-8000-000000000001" },
            { ...snapshot.entries[0], id: "a-note", kind: "note" },
        ],
    });
    expect(migrated.version).toBe(2);
    expect(migrated.entries[0]).toMatchObject({
        id: "test-object",
        brand: null,
        model: null,
        shoppingRelation: "contextual",
        ownership: "unknown",
    });
    expect(migrated.entries[1]).toMatchObject({ image: null, imageSource: null, images: [] });
});
