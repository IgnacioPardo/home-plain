import { resolve } from "node:path";
import { importPinterestReferences } from "../packages/backend/src/moodboard/pinterest.import.ts";

const [selectionPath, imagesDirectory, mediaDirectory, snapshotPath] = process.argv.slice(2);
if (!selectionPath || !imagesDirectory || !mediaDirectory || !snapshotPath)
    throw new Error(
        "Usage: import-pinterest.ts <selection.json> <images-directory> <media-directory> <existing-moodboard.json>",
    );
const snapshot = await importPinterestReferences({
    selectionPath: resolve(selectionPath),
    imagesDirectory: resolve(imagesDirectory),
    mediaDirectory: resolve(mediaDirectory),
    snapshotPath: resolve(snapshotPath),
    now: new Date(),
});
console.log(
    JSON.stringify({
        importedAt: snapshot.importedAt,
        references: snapshot.references.length,
        pinterest: snapshot.references.filter((reference) => reference.collection === "pinterest")
            .length,
    }),
);
