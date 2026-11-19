import { randomBytes, scrypt as deriveKey, timingSafeEqual } from "node:crypto";

const cost = { N: 131_072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const hashPattern = /^scrypt\$131072\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        deriveKey(password, salt, 64, cost, (error, key) => (error ? reject(error) : resolve(key)));
    });
}
export function isPasswordHash(value: string): boolean {
    return hashPattern.test(value);
}
export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await scrypt(password, salt);
    return `scrypt$131072$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
    const match = hashPattern.exec(encoded);
    if (!match) return false;
    const actual = await scrypt(password, Buffer.from(match[1]!, "base64url"));
    return timingSafeEqual(actual, Buffer.from(match[2]!, "base64url"));
}
