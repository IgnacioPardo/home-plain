import { hashPassword } from "../apps/api/src/auth/password.ts";

if (process.stdin.isTTY)
    throw new Error(
        "Read the password from a private file or pipe; do not put it in a command argument.",
    );
let input = "";
for await (const chunk of process.stdin) {
    input += String(chunk);
    if (input.length > 1026) throw new Error("Password is too long.");
}
const password = input.replace(/\r?\n$/, "");
if (password.length < 16 || password.length > 1024)
    throw new Error("Use a generated password of 16–1024 characters.");
process.stdout.write(`${await hashPassword(password)}\n`);
