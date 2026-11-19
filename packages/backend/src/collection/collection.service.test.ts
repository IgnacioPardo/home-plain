import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { CollectionRepository } from "./collection.repository.ts";
import { CollectionService } from "./collection.service.ts";

it("reloads atomic generations and retains the last good generation after malformed, missing and incomplete imports", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-catalog-reload-"));
    const path = join(directory, "collection.json");
    const first = {
        version: 2,
        source: "import",
        importedAt: "2026-11-18T10:00:00.000Z",
        entries: [],
    };
    const second = { ...first, importedAt: "2026-11-18T11:00:00.000Z" };
    const install = async (data: unknown) => {
        await writeFile(`${path}.tmp`, JSON.stringify(data));
        await rename(`${path}.tmp`, path);
    };
    try {
        const service = new CollectionService(new CollectionRepository(path, directory));
        expect(await service.read()).toBeNull();
        expect((await service.status()).state).toBe("missing");
        await install(first);
        expect(await service.read()).toEqual(first);
        await install(second);
        expect(await service.read()).toEqual(second);
        expect(await service.status()).toEqual({
            state: "ready",
            importedAt: second.importedAt,
            issue: null,
        });
        await writeFile(path, "{unfinished");
        expect(await service.read()).toEqual(second);
        expect((await service.status()).state).toBe("stale");
        await rm(path);
        expect(await service.read()).toEqual(second);
        await install({
            version: 1,
            source: "import",
            importedAt: first.importedAt,
            entries: [
                {
                    id: "image",
                    kind: "object",
                    title: "Example",
                    subtitle: "",
                    body: "",
                    category: "Hogar",
                    label: "",
                    image: "/media/missing.png",
                    imageAlt: "",
                    source: { title: "Example", url: "https://example.com" },
                    imageSource: null,
                    shoppingItemId: null,
                    layout: "square",
                    tone: "paper",
                },
            ],
        });
        expect(await service.read()).toEqual(second);
        expect((await service.status()).state).toBe("stale");
        await install(first);
        expect(await service.read()).toEqual(first);
        expect((await service.status()).state).toBe("ready");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
