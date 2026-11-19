import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
    atlasExportSchema,
    moodboardSnapshotSchema,
    type MoodboardSnapshot,
} from "./moodboard.schema.ts";

export async function importMoodboard(options: {
    catalogPath: string;
    imagesDirectory: string;
    mediaDirectory: string;
    snapshotPath: string;
    now: Date;
}): Promise<MoodboardSnapshot> {
    const raw = await readFile(options.catalogPath);
    const catalog = atlasExportSchema.parse(JSON.parse(raw.toString("utf8")));
    let previous: MoodboardSnapshot | null = null;
    try {
        previous = moodboardSnapshotSchema.parse(
            JSON.parse(await readFile(options.snapshotPath, "utf8")),
        );
    } catch (cause) {
        if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
    }
    await mkdir(options.mediaDirectory, { recursive: true });
    const copyImage = async (name: string, id: string): Promise<string | null> => {
        let bytes: Buffer;
        try {
            bytes = await readFile(join(options.imagesDirectory, name));
        } catch (cause) {
            if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null;
            throw cause;
        }
        if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
            throw new Error("Atlas media must contain JPEG image bytes");
        const hash = createHash("sha256").update(bytes).digest("hex");
        const filename = `atlas-${id}-${hash}.jpg`;
        const mediaPath = join(options.mediaDirectory, filename);
        const temporaryMedia = `${mediaPath}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporaryMedia, bytes, { mode: 0o600 });
            await rename(temporaryMedia, mediaPath);
        } finally {
            await rm(temporaryMedia, { force: true });
        }
        return `/media/${filename}`;
    };
    const references: MoodboardSnapshot["references"] = [];
    for (const ref of catalog.references) {
        const image = await copyImage(`${ref.id}.jpg`, ref.id);
        const thumbnail = await copyImage(`${ref.id}-t.jpg`, ref.id);
        references.push({ ...ref, collection: "atlas", image, thumbnail });
    }
    const snapshot = moodboardSnapshotSchema.parse({
        version: 1,
        importedAt: options.now.toISOString(),
        source: {
            title: catalog.title,
            url: catalog.source.url,
            conversation: catalog.source.conversation,
            sha256: createHash("sha256").update(raw).digest("hex"),
        },
        status: "exploratory",
        collections: [
            ...(previous?.collections ?? []).filter((collection) => collection.id !== "atlas"),
            {
                id: "atlas",
                title: catalog.title,
                url: catalog.source.url,
                importedAt: options.now.toISOString(),
            },
        ],
        references: [
            ...(previous?.references.filter((reference) => reference.collection === "pinterest") ??
                []),
            ...references,
        ],
    });
    await mkdir(dirname(options.snapshotPath), { recursive: true });
    const temporaryPath = `${options.snapshotPath}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
        await rename(temporaryPath, options.snapshotPath);
    } finally {
        await rm(temporaryPath, { force: true });
    }
    return snapshot;
}
