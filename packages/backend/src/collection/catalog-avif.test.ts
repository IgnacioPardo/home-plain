import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import { isCatalogAvif } from "./catalog-avif.ts";
import { cacheCatalogImage, sanitizeCatalogImage } from "./catalog-media.ts";

async function syntheticAvif() {
    return sharp({
        create: {
            width: 24,
            height: 16,
            channels: 4,
            background: { r: 40, g: 80, b: 100, alpha: 0.5 },
        },
    })
        .withMetadata({ orientation: 6 })
        .withExifMerge({ IFD0: { Copyright: "SYNTHETIC-PRIVATE-PHOTO-METADATA" } })
        .withXmp(
            '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description>SYNTHETIC-PRIVATE-XMP</rdf:Description></rdf:RDF></x:xmpmeta>',
        )
        .avif({ effort: 1, lossless: true })
        .toBuffer();
}

it("decodes synthetic AVIF bytes, preserves displayed dimensions and alpha, and strips all source metadata", async () => {
    const input = await syntheticAvif();
    const original = await sharp(input).metadata();
    expect(isCatalogAvif(input)).toBe(true);
    expect(original.exif).toBeDefined();
    expect(original.xmp).toBeDefined();
    expect(original.icc).toBeDefined();
    const converted = await sanitizeCatalogImage(input);
    const result = await sharp(converted.bytes).metadata();
    expect(converted.extension).toBe("webp");
    expect(result).toMatchObject({ format: "webp", width: 16, height: 24, hasAlpha: true });
    expect(result.exif).toBeUndefined();
    expect(result.xmp).toBeUndefined();
    expect(result.icc).toBeUndefined();
    expect(result.orientation).toBeUndefined();
    expect(converted.bytes.includes(Buffer.from("SYNTHETIC-PRIVATE"))).toBe(false);
});

it("rejects truncated and malformed AVIF without installing media, and refuses file paths or SVG", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-avif-invalid-"));
    try {
        const input = await syntheticAvif();
        for (const broken of [
            input.subarray(0, 20),
            input.subarray(0, input.length - 30),
            Buffer.concat([input.subarray(0, 32), Buffer.from("invalid container")]),
        ]) {
            await expect(
                cacheCatalogImage(
                    "https://images.example.com/photo",
                    directory,
                    ["images.example.com"],
                    async () => new Response(broken),
                ),
            ).rejects.toThrow("AVIF");
        }
        expect(await readdir(directory)).toEqual([]);
        await expect(
            sanitizeCatalogImage("/private/photo.avif" as unknown as Buffer),
        ).rejects.toThrow("downloaded image bytes");
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
        expect(isCatalogAvif(svg)).toBe(false);
        await expect(sanitizeCatalogImage(svg)).rejects.toThrow();
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it("enforces AVIF pixel bounds before decoding an oversized header", async () => {
    const input = Buffer.from(await syntheticAvif());
    const dimensions = input.indexOf(Buffer.from("ispe"));
    expect(dimensions).toBeGreaterThan(0);
    input.writeUInt32BE(10000, dimensions + 8);
    input.writeUInt32BE(10000, dimensions + 12);
    await expect(sanitizeCatalogImage(input)).rejects.toThrow("40-megapixel import limit");
});

it("caches AVIF as stable local WebP independently of misleading MIME and file extensions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-avif-cache-"));
    try {
        const input = await syntheticAvif();
        const request: typeof fetch = async () =>
            new Response(input, { headers: { "content-type": "image/jpeg" } });
        const first = await cacheCatalogImage(
            "https://images.example.com/photo.jpg?temporary=one",
            directory,
            ["images.example.com"],
            request,
        );
        const second = await cacheCatalogImage(
            "https://images.example.com/photo.jpg?temporary=two",
            directory,
            ["images.example.com"],
            request,
        );
        expect(first).toMatch(/^\/media\/catalog-[a-f0-9]{64}\.webp$/);
        expect(second).toBe(first);
        expect(await readdir(directory)).toHaveLength(1);
        const stored = await readFile(join(directory, first.slice("/media/".length)));
        expect((await sharp(stored).metadata()).format).toBe("webp");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
