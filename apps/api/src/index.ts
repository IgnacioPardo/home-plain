import { runWithTelemetry } from "@repo/telemetry";
await runWithTelemetry({ serviceName: "home-api" }, async () => {
    const { start } = await import("./server.ts");
    return start();
});
