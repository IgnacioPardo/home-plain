import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import { isCatalogAvif } from "./catalog-avif.ts";

/** Owner-only import transport; redirects must stay on explicitly configured public HTTPS hosts. */
export async function cacheCatalogImage(
    rawUrl: string,
    directory: string,
    allowedHosts: readonly string[],
    request: typeof fetch = fetch,
): Promise<string> {
    let target = new URL(rawUrl);
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 5; redirects++) {
        if (
            target.protocol !== "https:" ||
            target.username ||
            target.password ||
            target.port ||
            isIP(target.hostname) ||
            !allowedHosts.includes(target.hostname)
        )
            throw new Error(`Image host is not allowlisted for this import: ${target.hostname}`);
        response = await request(target.href, {
            redirect: "manual",
            signal: AbortSignal.timeout(30_000),
            headers: { Accept: "image/jpeg,image/png,image/webp,image/avif" },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location");
            await response.body?.cancel();
            if (!location) throw new Error("Image redirect is incomplete");
            target = new URL(location, target);
            response = undefined;
            continue;
        }
        break;
    }
    if (!response?.ok || !response.body) throw new Error("Catalog image download failed");
    if (Number(response.headers.get("content-length")) > 20_000_000) {
        await response.body.cancel();
        throw new Error("Catalog image exceeds import size limit");
    }
    const reader = response.body.getReader(),
        chunks: Buffer[] = [];
    let length = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            length += chunk.value.byteLength;
            if (length > 20_000_000) {
                await reader.cancel();
                throw new Error("Catalog image exceeds import size limit");
            }
            chunks.push(Buffer.from(chunk.value));
        }
    } finally {
        reader.releaseLock();
    }
    const { bytes, extension } = await sanitizeCatalogImage(Buffer.concat(chunks));
    const name = `catalog-${createHash("sha256").update(bytes).digest("hex")}.${extension}`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
    try {
        await writeFile(temporary, bytes, { mode: 0o600 });
        await rename(temporary, join(directory, name));
    } finally {
        await rm(temporary, { force: true });
    }
    return `/media/${name}`;
}

/** Decode all pixels and reencode without metadata, including JPEG markers after/between scans. */
export async function sanitizeCatalogImage(
    input: Buffer,
): Promise<{ bytes: Buffer; extension: "png" | "webp" }> {
    if (!Buffer.isBuffer(input))
        throw new Error("Catalog decoding requires downloaded image bytes");
    if (input.length > 20_000_000) throw new Error("Catalog image exceeds import size limit");
    const format = input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "png"
        : input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff
          ? "jpeg"
          : input.toString("ascii", 0, 4) === "RIFF" && input.toString("ascii", 8, 12) === "WEBP"
            ? "webp"
            : isCatalogAvif(input)
              ? "avif"
              : null;
    if (!format) throw new Error("Catalog media must be a complete PNG, JPEG, WebP or AVIF image");
    const label = format === "avif" ? "AVIF image" : "Catalog image";
    try {
        // This module is used only by the explicit owner import, never by API startup or requests.
        const { default: sharp } = await import("sharp");
        const decoder = sharp(input, {
            failOn: "warning",
            limitInputPixels: 40_000_000,
            limitInputChannels: 4,
            sequentialRead: true,
            unlimited: false,
        });
        const metadata = await decoder.metadata();
        if (
            metadata.format !== (format === "avif" ? "heif" : format) ||
            (format === "avif" && metadata.compression !== "av1") ||
            !metadata.width ||
            !metadata.height ||
            metadata.width * metadata.height > 40_000_000 ||
            (metadata.pages ?? 1) !== 1
        )
            throw new Error("Unsupported raster dimensions, codec or sequence");
        // Do not use keepMetadata/withMetadata: only oriented pixel data crosses into the new file.
        const oriented = decoder.autoOrient();
        const extension = format === "png" ? "png" : "webp";
        const encoded =
            extension === "png"
                ? oriented.png({ compressionLevel: 9 })
                : oriented.webp({ quality: 92 });
        const bytes = await encoded.timeout({ seconds: 30 }).toBuffer();
        if (bytes.length > 20_000_000) throw new Error("Raster output exceeds import size limit");
        return { bytes, extension };
    } catch (cause) {
        if (cause instanceof Error && /pixel limit/i.test(cause.message))
            throw new Error(`${label} exceeds the 40-megapixel import limit`);
        throw new Error(`${label} could not be decoded safely`);
    }
}
