import { isAbsolute } from "node:path";
import { defineConfig } from "vite-plus";
export default defineConfig({
    build: {
        target: "node22",
        outDir: "dist",
        minify: false,
        lib: { entry: { index: "src/index.ts", database: "src/database.ts" }, formats: ["es"] },
        rollupOptions: {
            external: (id) => !id.startsWith(".") && !isAbsolute(id),
            output: {
                preserveModules: true,
                preserveModulesRoot: "src",
                entryFileNames: "[name].js",
            },
        },
    },
    test: { include: ["src/**/*.test.ts"] },
    resolve: { conditions: ["@repo/source"] },
    ssr: { resolve: { conditions: ["@repo/source"] } },
});
