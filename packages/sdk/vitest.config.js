import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        testTimeout: 6000,
        environmentMatchGlobs: [["src/**", ""]],
        exclude: ["node_modules", "dist", ".idea", ".git", ".cache", "src/main/**", "package.json"]
    }
});