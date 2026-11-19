import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
    moodboardSnapshotSchema,
    pinterestSelectionSchema,
    type MoodboardSnapshot,
} from "./moodboard.schema.ts";

/** Owner-only local import. Image downloads and source review precede this atomic step. */
export async function importPinterestReferences(options: {
    selectionPath: string;
    imagesDirectory: string;
    mediaDirectory: string;
    snapshotPath: string;
    now: Date;
}): Promise<MoodboardSnapshot> {
    const selection = pinterestSelectionSchema.parse(
        JSON.parse(await readFile(options.selectionPath, "utf8")),
    );
    // Require the prior atlas explicitly: a missing file must not silently discard it.
    const previous = moodboardSnapshotSchema.parse(
        JSON.parse(await readFile(options.snapshotPath, "utf8")),
    );
    await mkdir(options.mediaDirectory, { recursive: true });
    const references: MoodboardSnapshot["references"] = [];
    for (const reference of selection.references) {
        const bytes = await readFile(join(options.imagesDirectory, `${reference.id}.jpg`));
        if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
            throw new Error("Pinterest media must contain JPEG image bytes");
        const hash = createHash("sha256").update(bytes).digest("hex");
        const filename = `pin-${reference.id}-${hash}.jpg`;
        const mediaPath = join(options.mediaDirectory, filename);
        const temporaryMedia = `${mediaPath}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporaryMedia, bytes, { mode: 0o600 });
            await rename(temporaryMedia, mediaPath);
        } finally {
            await rm(temporaryMedia, { force: true });
        }
        references.push({
            ...reference,
            collection: "pinterest",
            image: `/media/${filename}`,
            thumbnail: `/media/${filename}`,
        });
    }
    const importedAt = options.now.toISOString();
    const snapshot = moodboardSnapshotSchema.parse({
        ...previous,
        importedAt,
        collections: [
            ...(
                previous.collections ?? [
                    {
                        id: "atlas",
                        title: previous.source.title,
                        url: previous.source.url,
                        importedAt: previous.importedAt,
                    },
                ]
            ).filter((collection) => collection.id !== "pinterest"),
            { id: "pinterest", title: selection.title, url: selection.url, importedAt },
        ],
        references: [
            ...references,
            ...previous.references.filter((reference) => reference.collection !== "pinterest"),
        ],
    });
    await mkdir(dirname(options.snapshotPath), { recursive: true });
    const temporary = `${options.snapshotPath}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
        await rename(temporary, options.snapshotPath);
    } finally {
        await rm(temporary, { force: true });
    }
    return snapshot;
}
