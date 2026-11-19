import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { CatalogNotionReader, type CatalogRequest } from "./catalog-notion.reader.ts";
import { importCatalog, prepareCatalogGear, classifyGear } from "./catalog.import.ts";
import { catalogImportConfigSchema, type CatalogImportConfig } from "./catalog-import.schema.ts";
import { cacheCatalogImage, sanitizeCatalogImage } from "./catalog-media.ts";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPQCEhpAGEGGAMALsoFcZm5v9EAAAAASUVORK5CYII=",
    "base64",
);
const rich = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value }] });
const text = (value: string) => ({ type: "title", title: [{ plain_text: value }] });
const url = (value: string | null) => ({ type: "url", url: value });
const list = (results: unknown[], next_cursor: string | null = null) => ({
    results,
    has_more: Boolean(next_cursor),
    next_cursor,
});
const page = (pageId: string, dataSourceId: string, properties: unknown) => ({
    object: "page",
    id: pageId,
    parent: { type: "data_source_id", data_source_id: dataSourceId },
    properties,
});
const block = (blockId: string, type: string, payload: unknown, children = false) => ({
    object: "block",
    id: blockId,
    type,
    [type]: payload,
    has_children: children,
});
function fixture(directory: string) {
    const config: CatalogImportConfig = {
        gearDataSourceId: id(1),
        productReferencesDataSourceId: id(2),
        shoppingDataSourceId: id(3),
        snapshotPath: join(directory, "catalog.json"),
        reviewPath: join(directory, "review.json"),
        mediaDirectory: join(directory, "media"),
        imageHosts: ["images.example.com"],
        approvedGearMedia: [],
        includedGearPageIds: [id(10)],
        gearOverrides: {},
    };
    const gear = page(id(10), id(1), {
        Name: text("Example coffee machine"),
        Tags: { type: "multi_select", multi_select: [] },
        Sold: { type: "checkbox", checkbox: false },
        Website: url("https://example.com/machine"),
        Serial: rich("PRIVATE-SERIAL"),
        Size: rich("PRIVATE-SIZE"),
        Date: rich("PRIVATE-DATE"),
    });
    const sold = page(id(11), id(1), {
        ...(gear.properties as object),
        Sold: { type: "checkbox", checkbox: true },
    });
    const product = page(id(20), id(2), {
        Nombre: text("Example model"),
        "Compra ID": rich(id(30)),
        Marca: rich("Example"),
        Modelo: rich("Model"),
        Materiales: rich("Steel; Glass"),
        Motivo: rich("Fits the documented need"),
        Fuente: url("https://example.com/model"),
        Imagen: url("https://images.example.com/model.png"),
        "Fuente imagen": url("https://example.com/model/photos"),
        Categoría: { type: "select", select: { name: "Hogar" } },
        Ambientes: { type: "multi_select", multi_select: [{ name: "Cocina" }] },
    });
    const shopping = page(id(30), id(3), {});
    const responses = new Map<string, unknown>([
        [`data_sources/${id(1)}/query`, list([gear], "next")],
        [`data_sources/${id(1)}/query:next`, list([sold])],
        [`data_sources/${id(2)}/query`, list([product])],
        [`data_sources/${id(3)}/query`, list([shopping])],
        [
            `blocks/${id(10)}/children?page_size=100`,
            list([
                block(id(100), "image", {
                    type: "file",
                    file: { url: "https://images.example.com/gear.png?token=private" },
                }),
                block(id(101), "paragraph", { rich_text: [{ plain_text: "PRIVATE-NOTE" }] }),
                block(id(102), "child_page", { title: "Private receipt" }, true),
            ]),
        ],
        [`blocks/${id(20)}/children?page_size=100`, list([])],
    ]);
    const request: CatalogRequest = vi.fn(async (path, body) => {
        const key = `${path}${body?.start_cursor ? `:${body.start_cursor}` : ""}`;
        if (!responses.has(key)) throw new Error(`Unexpected test request ${key}`);
        return responses.get(key);
    });
    const fetchImage = vi.fn(
        async () => new Response(png, { headers: { "content-type": "image/png" } }),
    ) as unknown as typeof fetch;
    return {
        config,
        gear,
        product,
        responses,
        request,
        reader: new CatalogNotionReader(request),
        fetchImage,
    };
}

it("fully paginates unsold gear, projects only safe fields, preserves legacy IDs and gates personal images on explicit review", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-catalog-import-"));
    try {
        const f = fixture(directory);
        f.config.gearOverrides[id(10)] = {
            ownership: "reference",
            category: "Hogar",
            reason: "Belongs to family",
            model: "Example",
            brand: "Example",
        };
        f.config.legacySnapshotPath = join(directory, "legacy.json");
        await writeFile(
            f.config.legacySnapshotPath,
            JSON.stringify({
                version: 1,
                source: "import",
                importedAt: "2026-11-12T10:00:00.000Z",
                entries: [
                    {
                        id: "existing-id",
                        kind: "object",
                        title: "Previous",
                        subtitle: "",
                        body: "",
                        category: "Hogar",
                        label: "",
                        image: null,
                        imageAlt: "",
                        source: {
                            title: "Inventario",
                            url: `https://app.notion.com/p/${id(10).replaceAll("-", "")}`,
                        },
                        imageSource: null,
                        shoppingItemId: id(30),
                        layout: "square",
                        tone: "paper",
                    },
                ],
            }),
        );
        const prepare = await prepareCatalogGear({
            config: f.config,
            reader: f.reader,
            request: f.fetchImage,
        });
        expect(prepare.entries).toHaveLength(1);
        expect(prepare.entries[0]).toMatchObject({
            id: "existing-id",
            ownership: "reference",
            shoppingRelation: "contextual",
            category: "Hogar",
        });
        expect(prepare.entries[0]?.images).toHaveLength(1);
        await expect(readFile(f.config.snapshotPath)).rejects.toMatchObject({ code: "ENOENT" });
        expect(JSON.stringify(prepare)).not.toMatch(/PRIVATE-|token=private|Serial|Size|Date/);
        const first = await importCatalog({
            config: f.config,
            reader: f.reader,
            request: f.fetchImage,
        });
        expect(first.entries).toHaveLength(2);
        expect(first.entries[0]?.images).toEqual([]);
        expect(first.entries[1]).toMatchObject({
            provenance: "home-reference",
            shoppingRelation: "exact",
            brand: "Example",
            model: "Model",
            materials: ["Steel", "Glass"],
            rooms: ["Cocina"],
            productSource: { url: "https://example.com/model" },
        });
        f.config.approvedGearMedia = prepare.entries[0]!.images.map((image) => image.path);
        const second = await importCatalog({
            config: f.config,
            reader: f.reader,
            request: f.fetchImage,
        });
        expect(second.entries[0]?.images).toEqual(prepare.entries[0]?.images);
        expect(second.entries.map((entry) => entry.id)).toEqual(
            first.entries.map((entry) => entry.id),
        );
        expect(JSON.parse(await readFile(f.config.snapshotPath, "utf8"))).toEqual(second);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it("requires a Home selection independently of inventory and image approval, including cached preparation and reimport", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-catalog-selection-"));
    try {
        const f = fixture(directory);
        const initial = await importCatalog({
            config: f.config,
            reader: f.reader,
            request: f.fetchImage,
        });
        const originalGearId = initial.entries[0]!.id;
        f.config.legacySnapshotPath = f.config.snapshotPath;
        // A newly discovered inventory item is not automatically part of this home or move.
        const unrelated = page(id(12), id(1), {
            ...(f.gear.properties as object),
            Name: text("Inventory bicycle"),
        });
        f.responses.set(`data_sources/${id(1)}/query:next`, list([unrelated]));
        f.responses.set(
            `blocks/${id(12)}/children?page_size=100`,
            list([
                block(id(120), "image", {
                    type: "external",
                    external: { url: "https://unreviewed.example.com/bicycle.png" },
                }),
            ]),
        );
        const selected = await importCatalog({
            config: f.config,
            reader: f.reader,
            request: f.fetchImage,
        });
        expect(
            selected.entries
                .filter((entry) => entry.provenance === "my-gear")
                .map((entry) => entry.id),
        ).toEqual([originalGearId]);

        // Existing approvals and ID mappings must not resurrect a record removed from the selection.
        f.config.approvedGearMedia = [
            await cacheCatalogImage(
                "https://images.example.com/gear.png",
                f.config.mediaDirectory,
                f.config.imageHosts,
                f.fetchImage,
            ),
        ];
        const { includedGearPageIds: _previousSelection, ...withoutSelection } = f.config;
        const config = catalogImportConfigSchema.parse(withoutSelection);
        const imported = await importCatalog({ config, reader: f.reader, request: f.fetchImage });
        expect(imported.entries.map((entry) => entry.provenance)).toEqual(["home-reference"]);
        expect(imported.entries[0]!.id).toBe(initial.entries[1]!.id);
        expect(JSON.parse(await readFile(config.snapshotPath, "utf8"))).toEqual(imported);
        const request = vi.fn() as unknown as typeof fetch;
        const cached = await prepareCatalogGear({
            config,
            reader: f.reader,
            request,
            preparedGear: [
                {
                    pageId: id(10),
                    title: "Previously selected",
                    tags: [],
                    website: null,
                    images: ["https://unreviewed.example.com/cached.png"],
                },
            ],
        });
        expect(cached.entries).toEqual([]);
        expect(request).not.toHaveBeenCalled();
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it("keeps the installed snapshot untouched on pagination drift, missing references or invalid images", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-catalog-failure-"));
    try {
        const f = fixture(directory);
        const good = await importCatalog({
            config: f.config,
            reader: f.reader,
            request: f.fetchImage,
        });
        f.responses.set(`data_sources/${id(1)}/query:next`, list([], "next"));
        await expect(
            importCatalog({ config: f.config, reader: f.reader, request: f.fetchImage }),
        ).rejects.toThrow("Incomplete catalog pagination");
        f.responses.set(`data_sources/${id(1)}/query:next`, list([]));
        f.responses.set(`data_sources/${id(2)}/query`, list([]));
        await expect(
            importCatalog({ config: f.config, reader: f.reader, request: f.fetchImage }),
        ).rejects.toThrow("every shopping need");
        f.responses.set(`data_sources/${id(2)}/query`, list([f.product]));
        const invalid = vi.fn(
            async () => new Response("<html>not an image</html>"),
        ) as unknown as typeof fetch;
        await expect(
            importCatalog({ config: f.config, reader: f.reader, request: invalid }),
        ).rejects.toThrow("Catalog media must");
        expect(JSON.parse(await readFile(f.config.snapshotPath, "utf8"))).toEqual(good);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it("rejects source drift, duplicate records and missing sold properties instead of publishing a partial inventory", async () => {
    const f = fixture("/unused");
    f.responses.set(`data_sources/${id(1)}/query:next`, list([f.gear]));
    await expect(f.reader.gear(id(1))).rejects.toThrow("repeated page");
    f.responses.set(`data_sources/${id(1)}/query:next`, list([]));
    f.responses.set(
        `data_sources/${id(1)}/query`,
        list([{ ...f.gear, parent: { type: "data_source_id", data_source_id: id(99) } }]),
    );
    await expect(f.reader.gear(id(1))).rejects.toThrow("invalid source");
    f.responses.set(
        `data_sources/${id(1)}/query`,
        list([{ ...f.gear, properties: { ...(f.gear.properties as object), Sold: undefined } }]),
    );
    await expect(f.reader.gear(id(1))).rejects.toThrow();
});

it("accepts complete image bytes, strips private PNG text, and refuses nonallowlisted redirects", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-catalog-media-"));
    try {
        const input = await sharp(png)
            .withExif({ IFD0: { Copyright: "SYNTHETIC-PRIVATE-PHOTO" } })
            .png()
            .toBuffer();
        expect((await sharp(input).metadata()).exif).toBeDefined();
        const cleaned = await sanitizeCatalogImage(input);
        expect((await sharp(cleaned.bytes).metadata()).exif).toBeUndefined();
        expect(cleaned.bytes.includes(Buffer.from("SYNTHETIC-PRIVATE"))).toBe(false);
        await expect(sanitizeCatalogImage(png.subarray(0, 40))).rejects.toThrow();
        await expect(sanitizeCatalogImage(Buffer.from("<svg/>"))).rejects.toThrow();
        const request = vi.fn(
            async () =>
                new Response(null, {
                    status: 302,
                    headers: { location: "https://127.0.0.1/private" },
                }),
        ) as unknown as typeof fetch;
        await expect(
            cacheCatalogImage(
                "https://images.example.com/photo",
                directory,
                ["images.example.com"],
                request,
            ),
        ).rejects.toThrow("not allowlisted");
        expect(request).toHaveBeenCalledTimes(1);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it("categorizes source names and tags without requiring a Home tag", () => {
    expect(classifyGear("Audio-Technica AT-LP120", [])).toBe("Audio y música");
    expect(classifyGear("MX Master 3S", ["Logitech"])).toBe("Trabajo");
    expect(classifyGear("Lars Mug Grey", [])).toBe("Hogar");
    expect(classifyGear("Seiko 5", [])).toBe("Accesorios personales");
    expect(classifyGear("Unclassified source title", [])).toBe("Otros");
});

it("applies JPEG display orientation to pixels without retaining source EXIF or ICC", async () => {
    const input = await sharp({
        create: { width: 24, height: 16, channels: 3, background: { r: 40, g: 80, b: 100 } },
    })
        .withMetadata({ orientation: 6 })
        .withExifMerge({ IFD0: { Copyright: "SYNTHETIC-PRIVATE-PHOTO" } })
        .jpeg({ progressive: true })
        .toBuffer();
    const original = await sharp(input).metadata();
    expect(original.orientation).toBe(6);
    expect(original.exif).toBeDefined();
    expect(original.icc).toBeDefined();
    const cleaned = await sanitizeCatalogImage(input);
    const result = await sharp(cleaned.bytes).metadata();
    expect(result).toMatchObject({ width: 16, height: 24 });
    expect(result.exif).toBeUndefined();
    expect(result.icc).toBeUndefined();
    expect(result.orientation).toBeUndefined();
    expect(cleaned.bytes.includes(Buffer.from("SYNTHETIC-PRIVATE"))).toBe(false);
});

it.each([
    ["Periodic Table Mug", ["Accessory", "Object", "Mug"], "Hogar"],
    ["Ello Jones Travel Mug", ["Accessory"], "Hogar"],
    ["AT-LP120XBT-USB", ["Tech", "Music", "Retro"], "Audio y música"],
    ["Samson R21", ["Tech", "Music"], "Audio y música"],
    ["Logitech UE4000", ["Tech", "Music", "Accessory"], "Audio y música"],
    ["Focusrite Scarlett 2i4", ["Music", "Tech", "Desk", "Guitar"], "Audio y música"],
    ["Pentax IQZoom 115", ["Tech", "Photography", "Retro"], "Fotografía"],
    ["Sony FD Mavica", ["Tech", "Photography", "Sony"], "Fotografía"],
    ["Camera example", ["Photography", "Music"], "Fotografía"],
    ["Model car example", ["Car", "Decoration", "Model Car"], "Hogar"],
    ["Bicycle 807 Rider Back", ["Object", "Playing Cards"], "Hogar"],
    ["Frank E-Bike Elite", ["Bike"], "Deporte y movilidad"],
    ["Vehicle example", ["Car"], "Deporte y movilidad"],
    ["Casio fx-991EX", ["Desk"], "Trabajo"],
    ["Casio fx-991EX", [], "Trabajo"],
    ["Running shoe example", ["Sport", "Shoes"], "Ropa y calzado"],
    ["Logitech MX Master 3S", ["Tech", "Accessory"], "Trabajo"],
    ["UGREEN Wallet Tracker Card", ["Tech", "Accessory"], "Tecnología"],
    ["Personal accessory example", ["Accessory", "Tech"], "Accesorios personales"],
    ["Unknown gadget", ["Tech"], "Tecnología"],
    ["Unknown source item", [], "Otros"],
])("uses specific domain tags and title evidence for %s", (title, tags, expected) => {
    expect(classifyGear(title, tags)).toBe(expected);
    expect(classifyGear(title, [...tags].reverse())).toBe(expected);
});

it("reports every unapproved image host and preserves a complete private source cache for review retries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-catalog-hosts-"));
    try {
        const f = fixture(directory);
        f.responses.set(
            `blocks/${id(10)}/children?page_size=100`,
            list(
                [
                    block(id(100), "image", {
                        type: "external",
                        external: { url: "https://one.example.com/image.png" },
                    }),
                    block(id(101), "image", {
                        type: "external",
                        external: { url: "https://two.example.com/image.png" },
                    }),
                ],
                "second",
            ),
        );
        f.responses.set(
            `blocks/${id(10)}/children?page_size=100&start_cursor=second`,
            list([
                block(id(102), "image", {
                    type: "external",
                    external: { url: "https://three.example.com/image.png" },
                }),
            ]),
        );
        await expect(
            prepareCatalogGear({ config: f.config, reader: f.reader, request: f.fetchImage }),
        ).rejects.toThrow("one.example.com, three.example.com, two.example.com");
        expect(f.fetchImage).not.toHaveBeenCalled();
        const cache = JSON.parse(await readFile(`${f.config.reviewPath}.sources.json`, "utf8"));
        expect(cache.records).toHaveLength(1);
        expect(cache.records[0].images).toHaveLength(3);
        expect(JSON.stringify(cache)).not.toMatch(/PRIVATE-|Serial|Size|Date/);
        await expect(readFile(f.config.snapshotPath)).rejects.toMatchObject({ code: "ENOENT" });
        f.config.imageHosts = ["one.example.com", "two.example.com", "three.example.com"];
        const reader = new CatalogNotionReader(
            vi.fn(async () => {
                throw new Error("Cached preparation must not query Notion");
            }),
        );
        const result = await prepareCatalogGear({
            config: f.config,
            reader,
            request: f.fetchImage,
            preparedGear: cache.records,
        });
        expect(f.fetchImage).toHaveBeenCalledTimes(3);
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]?.images).toHaveLength(1); // Identical image bytes are deduplicated.
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it("omits only explicitly excluded image sources before host checks in cached and fresh imports", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-catalog-exclusions-"));
    try {
        const f = fixture(directory);
        f.responses.set(
            `blocks/${id(10)}/children?page_size=100`,
            list([
                block(id(100), "image", {
                    type: "external",
                    external: { url: "https://images.example.com/photo.png" },
                }),
                block(id(101), "image", {
                    type: "external",
                    external: {
                        url: "https://unapproved.example.com/logo.svg?signature=temporary",
                    },
                }),
            ]),
        );
        f.config.gearOverrides[id(10)] = {
            excludedImageSources: ["https://unapproved.example.com/logo.svg"],
        };
        const records = await f.reader.gear(f.config.gearDataSourceId);
        const cachedReader = new CatalogNotionReader(
            vi.fn(async () => {
                throw new Error("No Notion reads during cached preparation");
            }),
        );
        const prepared = await prepareCatalogGear({
            config: f.config,
            reader: cachedReader,
            request: f.fetchImage,
            preparedGear: records,
        });
        expect(prepared.entries).toHaveLength(1);
        expect(prepared.entries[0]?.images).toHaveLength(1);
        expect(f.fetchImage).toHaveBeenCalledTimes(1);
        expect(f.fetchImage).toHaveBeenLastCalledWith(
            "https://images.example.com/photo.png",
            expect.any(Object),
        );
        f.config.approvedGearMedia = prepared.entries[0]!.images.map((image) => image.path);
        const published = await importCatalog({
            config: f.config,
            reader: f.reader,
            request: f.fetchImage,
        });
        expect(
            published.entries.find((entry) => entry.provenance === "my-gear")?.images,
        ).toHaveLength(1);
        expect(f.fetchImage).toHaveBeenCalledTimes(3); // One cached gear image, then fresh gear + product images.
        expect(JSON.stringify(published)).not.toContain("logo.svg");
        delete f.config.gearOverrides[id(10)]!.excludedImageSources;
        await expect(
            prepareCatalogGear({
                config: f.config,
                reader: cachedReader,
                request: f.fetchImage,
                preparedGear: records,
            }),
        ).rejects.toThrow("unapproved.example.com");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it.each(["", "/"])(
    "preserves separate Inventario and home-reference identities across migration and reimports with source URL suffix %s",
    async (suffix) => {
        const directory = await mkdtemp(join(tmpdir(), "home-catalog-identity-"));
        try {
            const f = fixture(directory);
            const old = (entryId: string, kind: "reference" | "note", sourcePageId: string) => ({
                id: entryId,
                kind,
                title: "Synthetic legacy entry",
                subtitle: "",
                body: "",
                category: "Hogar",
                label: "",
                image: null,
                imageAlt: "",
                source: {
                    title: "Notion",
                    url: `https://app.notion.com/p/${sourcePageId.replaceAll("-", "")}${suffix}`,
                },
                imageSource: null,
                shoppingItemId: kind === "reference" ? id(30) : null,
                layout: "square",
                tone: "paper",
            });
            f.config.legacySnapshotPath = join(directory, "legacy.json");
            await writeFile(
                f.config.legacySnapshotPath,
                JSON.stringify({
                    version: 1,
                    source: "import",
                    importedAt: "2026-11-12T10:00:00.000Z",
                    entries: [
                        old("family-machine", "reference", id(10)),
                        old("coffee-reference", "reference", id(30)),
                        old("existing-note", "note", id(40)),
                    ],
                }),
            );
            f.config.gearOverrides[id(10)] = {
                ownership: "reference",
                reason: "Family-owned example",
            };
            const first = await importCatalog({
                config: f.config,
                reader: f.reader,
                request: f.fetchImage,
            });
            expect(first.entries.map((entry) => entry.id)).toEqual([
                "family-machine",
                "coffee-reference",
                "existing-note",
            ]);
            expect(first.entries[0]).toMatchObject({
                provenance: "my-gear",
                kind: "reference",
                shoppingRelation: "contextual",
            });
            expect(first.entries[1]).toMatchObject({
                provenance: "home-reference",
                kind: "reference",
                shoppingRelation: "exact",
            });
            f.config.legacySnapshotPath = f.config.snapshotPath;
            const second = await importCatalog({
                config: f.config,
                reader: f.reader,
                request: f.fetchImage,
            });
            expect(second.entries.map((entry) => entry.id)).toEqual(
                first.entries.map((entry) => entry.id),
            );
            f.responses.set(
                `data_sources/${id(1)}/query`,
                list([
                    {
                        ...f.gear,
                        properties: {
                            ...(f.gear.properties as object),
                            Sold: { type: "checkbox", checkbox: true },
                        },
                    },
                ]),
            );
            const sold = await importCatalog({
                config: f.config,
                reader: f.reader,
                request: f.fetchImage,
            });
            expect(sold.entries.map((entry) => entry.id)).toEqual([
                "coffee-reference",
                "existing-note",
            ]);
            f.responses.set(`data_sources/${id(1)}/query`, list([]));
            const deleted = await importCatalog({
                config: f.config,
                reader: f.reader,
                request: f.fetchImage,
            });
            expect(deleted.entries.map((entry) => entry.id)).toEqual([
                "coffee-reference",
                "existing-note",
            ]);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    },
);
