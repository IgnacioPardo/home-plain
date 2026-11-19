import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { catalogImportConfigSchema } from "../packages/backend/src/collection/catalog-import.schema.ts";
import {
    CatalogNotionReader,
    gearSourceCacheSchema,
    type CatalogRequest,
} from "../packages/backend/src/collection/catalog-notion.reader.ts";
import {
    importCatalog,
    prepareCatalogGear,
} from "../packages/backend/src/collection/catalog.import.ts";

const [command, file] = process.argv.slice(2);
if (!["prepare-gear", "prepare-gear-cached", "import"].includes(command ?? "") || !file)
    throw new Error(
        "Usage: import-catalog.ts <prepare-gear|prepare-gear-cached|import> <private-config.json>",
    );
const configPath = resolve(file),
    directory = dirname(configPath);
const config = catalogImportConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
config.snapshotPath = resolve(directory, config.snapshotPath);
config.reviewPath = resolve(directory, config.reviewPath);
config.mediaDirectory = resolve(directory, config.mediaDirectory);
if (config.legacySnapshotPath)
    config.legacySnapshotPath = resolve(directory, config.legacySnapshotPath);
if (config.reviewPath === config.snapshotPath)
    throw new Error("Review output must differ from the published snapshot");

// Official ntn keeps its login in the OS keychain. Never read credentials or print upstream bodies.
const callNtn: CatalogRequest = async (path, body) => {
    const endpoint = new URL(`https://api.notion.com/v1/${path}`);
    const args = ["api", endpoint.pathname.slice(1), "--notion-version", "2026-03-11"];
    for (const [key, value] of endpoint.searchParams) args.push(`${key}==${value}`);
    if (body) args.push("-X", "POST", "--data", "@-");
    return new Promise((resolveResult, reject) => {
        const child = spawn("ntn", args, { stdio: ["pipe", "pipe", "pipe"] });
        const chunks: Buffer[] = [];
        let size = 0,
            finished = false;
        const fail = () => {
            if (!finished) {
                finished = true;
                reject(
                    new Error(
                        "Official Notion CLI request failed; check ntn login and source access",
                    ),
                );
            }
        };
        const timeout = setTimeout(() => {
            child.kill();
            fail();
        }, 60_000);
        child.stdout.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 32_000_000) {
                child.kill();
                fail();
            } else chunks.push(chunk);
        });
        child.stderr.resume();
        child.on("error", fail);
        child.on("close", (code) => {
            clearTimeout(timeout);
            if (finished) return;
            if (code !== 0) return fail();
            try {
                finished = true;
                resolveResult(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
                reject(new Error("Official Notion CLI returned invalid JSON"));
            }
        });
        child.stdin.on("error", () => {});
        child.stdin.end(body ? JSON.stringify(body) : undefined);
    });
};
const request: CatalogRequest = async (path, body) => {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await callNtn(path, body);
        } catch (error) {
            if (attempt === 2) throw error;
            await new Promise<void>((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
        }
    }
    throw new Error("Official Notion CLI request failed");
};
try {
    const reader = new CatalogNotionReader(request);
    let preparedGear;
    if (command === "prepare-gear-cached") {
        const cache = gearSourceCacheSchema.parse(
            JSON.parse(await readFile(`${config.reviewPath}.sources.json`, "utf8")),
        );
        if (cache.dataSourceId !== config.gearDataSourceId)
            throw new Error("Gear review cache belongs to another source");
        preparedGear = cache.records;
    }
    const result =
        command === "import"
            ? await importCatalog({ config, reader })
            : await prepareCatalogGear({ config, reader, preparedGear });
    console.log(
        JSON.stringify(
            {
                mode: command,
                entries: result.entries.length,
                gear: result.entries.filter((entry) => entry.provenance === "my-gear").length,
                references: result.entries.filter((entry) => entry.provenance === "home-reference")
                    .length,
                images: result.entries.reduce((sum, entry) => sum + entry.images.length, 0),
                withoutImages: result.entries.filter(
                    (entry) => entry.kind !== "note" && !entry.images.length,
                ).length,
                importedAt: result.importedAt,
            },
            null,
            2,
        ),
    );
} catch (error) {
    console.error(error instanceof Error ? error.message : "Catalog import failed");
    process.exitCode = 1;
}
