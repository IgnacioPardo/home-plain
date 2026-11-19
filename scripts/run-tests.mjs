import { spawnSync } from "node:child_process";
const result = spawnSync("pnpm", ["-r", "--if-present", "test"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
