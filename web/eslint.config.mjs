import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // The server layer + the tolerant AI-JSON parser are faithful ports of the old
  // edge function / client helpers, which handle dynamic Anthropic/Notion/config
  // JSON where `any` (and bound-but-unused catch vars) are the appropriate shape.
  {
    files: ["src/server/**/*.ts", "src/app/api/**/*.ts", "src/lib/ai-json.ts", "src/lib/sync/**/*.ts", "src/lib/store/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { caughtErrors: "none" }],
    },
  },
]);

export default eslintConfig;
