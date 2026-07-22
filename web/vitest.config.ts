import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
  },
  resolve: {
    // Mirrors the "@/*" -> "./src/*" path alias in tsconfig.json. Next resolves it
    // at build time, vitest does not — without this any test that reaches a module
    // importing via the alias (e.g. server/prompts.ts) fails to import.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
