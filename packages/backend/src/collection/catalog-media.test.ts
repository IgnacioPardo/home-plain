import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import { cacheCatalogImage, sanitizeCatalogImage } from "./catalog-media.ts";

it("removes private JPEG COM and APP markers between progressive scans and after the final scan", async () => {
    const directory = await mkdtemp(join(tmpdir(), "home-jpeg-markers-"));
    try {
        const image = await sharp({
            create: { width: 2, height: 2, channels: 3, background: { r: 40, g: 80, b: 100 } },
        })
            .jpeg({ progressive: true })
            .toBuffer();
        const marker = (kind: number, body: string) => {
            const payload = Buffer.from(body),
                head = Buffer.from([0xff, kind, 0, 0]);
            head.writeUInt16BE(payload.length + 2, 2);
            return Buffer.concat([head, payload]);
        };
        const firstScan = image.indexOf(Buffer.from([0xff, 0xda]));
        const secondScan = image.indexOf(Buffer.from([0xff, 0xda]), firstScan + 2);
        expect(firstScan).toBeGreaterThan(0);
        expect(secondScan).toBeGreaterThan(firstScan);
        const dirty = Buffer.concat([
            image.subarray(0, secondScan),
            marker(0xfe, "SYNTHETIC-PRIVATE-INTERSCAN-SERIAL"),
            marker(0xef, "SYNTHETIC-PRIVATE-INTERSCAN-GPS"),
            image.subarray(secondScan, image.length - 2),
            marker(0xfe, "SYNTHETIC-PRIVATE-SERIAL-AND-GPS"),
            marker(0xed, "SYNTHETIC-PRIVATE-POSTSCAN-APP"),
            image.subarray(image.length - 2),
        ]);
        // Prove the extra segments are legal and don't change the source image's pixels.
        expect(await sharp(dirty).raw().toBuffer()).toEqual(await sharp(image).raw().toBuffer());
        const clean = await sanitizeCatalogImage(dirty);
        expect(clean.bytes.includes(Buffer.from("SYNTHETIC-PRIVATE"))).toBe(false);
        expect(clean.bytes).toEqual((await sanitizeCatalogImage(image)).bytes);
        expect(await sharp(clean.bytes).metadata()).toMatchObject({
            format: "webp",
            width: 2,
            height: 2,
        });
        const path = await cacheCatalogImage(
            "https://images.example.com/photo.jpg",
            directory,
            ["images.example.com"],
            async () => new Response(dirty),
        );
        const installed = await readFile(join(directory, path.slice("/media/".length)));
        expect(installed).toEqual(clean.bytes);
        expect(installed.includes(Buffer.from("SYNTHETIC-PRIVATE"))).toBe(false);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
