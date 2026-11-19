/** Identify AVIF by its ISO BMFF file-type brands, never its URL or response MIME type. */
export function isCatalogAvif(input: Buffer): boolean {
    if (!Buffer.isBuffer(input) || input.length < 12 || input.toString("ascii", 4, 8) !== "ftyp")
        return false;
    if (["avif", "avis"].includes(input.toString("ascii", 8, 12))) return true;
    const end = Math.min(input.readUInt32BE(0), input.length, 4096);
    for (let offset = 16; offset + 4 <= end; offset += 4)
        if (["avif", "avis"].includes(input.toString("ascii", offset, offset + 4))) return true;
    return false;
}
