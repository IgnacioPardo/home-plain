import { resolve } from "node:path";
import { importMoodboard } from "../packages/backend/src/moodboard/moodboard.import.ts";

const [catalogPath, imagesDirectory, mediaDirectory, snapshotPath] = process.argv.slice(2);
if (!catalogPath || !imagesDirectory || !mediaDirectory || !snapshotPath)
    throw new Error(
        "Usage: import-moodboard.ts <catalog.json> <images-directory> <media-directory> <snapshot.json>",
    );
const snapshot = await importMoodboard({
    catalogPath: resolve(catalogPath),
    imagesDirectory: resolve(imagesDirectory),
    mediaDirectory: resolve(mediaDirectory),
    snapshotPath: resolve(snapshotPath),
    now: new Date(),
});
console.log(
    JSON.stringify(
        {
            references: snapshot.references.length,
            publications: new Set(snapshot.references.map((ref) => ref.projectKey)).size,
            directions: new Set(snapshot.references.flatMap((ref) => ref.styles)).size,
            missingImages: snapshot.references.filter((ref) => !ref.image && !ref.thumbnail).length,
            importedAt: snapshot.importedAt,
        },
        null,
        2,
    ),
);
