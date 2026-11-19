import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";

// Scan committed files plus nonignored candidates; never read ignored runtime data.
const files = [
    ...new Set(
        execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
            encoding: "utf8",
        })
            .split("\0")
            .filter(Boolean),
    ),
];
const failures = [];
for (const file of files) {
    const fail = (reason) => failures.push(`${file}: ${reason}`);
    if (
        /(^|\/)(data|\.scratch|node_modules|dist|deploy)\//.test(file) ||
        (/(^|\/)\.env(?:\..*)?$/.test(file) && !file.endsWith(".env.example")) ||
        /\.(?:pem|key|p12|pfx|sqlite|db|zip|tar|gz)$/i.test(file)
    ) {
        fail("runtime, deployment, credential or archive file must stay out of Git");
        continue;
    }
    if (lstatSync(file).isSymbolicLink()) {
        fail("review symlinks before publication");
        continue;
    }
    const bytes = readFileSync(file);
    if (/\.(?:png|jpe?g|webp|gif|pdf|mp4|mov)$/i.test(file) || bytes.includes(0)) {
        // These exact screenshots are generated from examples/ and reviewed visually.
        if (
            !["docs/screenshots/demo-desktop.png", "docs/screenshots/demo-mobile.png"].includes(
                file,
            )
        )
            fail("unreviewed binary or media file");
        continue;
    }
    const content = bytes.toString("utf8");
    if (/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//.test(content))
        fail("personal absolute filesystem path");
    if (
        /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|(?:gh[pousr]_|github_pat_|ntn_|secret_)[A-Za-z0-9_]{24,}|AKIA[0-9A-Z]{16}/.test(
            content,
        )
    )
        fail("credential-shaped literal");
    if (/scrypt\$131072\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}/.test(content))
        fail("literal password hash");
    for (const match of content.matchAll(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    ))
        if (!match[0].startsWith("00000000-0000-4000-8000-")) fail("non-synthetic UUID literal");
    if (/https?:\/\/(?:[^\s/]+\.)?chatgpt\.(?:com|site)\//.test(content))
        fail("personal conversation or generated-site link");
    for (const match of content.matchAll(
        /https?:\/\/(?:[a-z.]+\.)?notion\.(?:so|com)\/(?:p\/)?([a-f0-9]{32})/gi,
    ))
        if (!match[1].startsWith("00000000000040008000")) fail("non-synthetic workspace link");
}
if (failures.length) {
    console.error([...new Set(failures)].join("\n"));
    process.exitCode = 1;
} else
    console.log(
        `Public-source guard passed (${files.length} files). Review new content before publication.`,
    );
