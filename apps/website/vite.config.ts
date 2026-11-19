import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";
export default defineConfig({
    envDir: "../..",
    resolve: {
        alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
        conditions: ["@repo/source"],
    },
    plugins: [react(), tailwindcss()],
    test: { include: ["src/**/*.test.tsx"], environment: "happy-dom" },
    ssr: { resolve: { conditions: ["@repo/source"] } },
    server: {
        host: "127.0.0.1",
        port: 5173,
        strictPort: true,
        proxy: {
            "/auth": { target: "http://127.0.0.1:3000", changeOrigin: false },
            "/trpc": { target: "http://127.0.0.1:3000", changeOrigin: false },
            "/health": { target: "http://127.0.0.1:3000", changeOrigin: false },
            "/media": { target: "http://127.0.0.1:3000", changeOrigin: false },
        },
    },
});
