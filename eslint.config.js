import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    "node_modules/**",
    "dist/**",
    ".next/**",
    ".speclens-workspace/**",
    "reports/**",
    "archive/**",
    "docs/archive/**",
    "backend/**",
    "public/**",
    "src/**",
    "tools/**",
    "tests/e2e/**",
    "packages/cli/**",
    "packages/http/**",
    "packages/core/src/**/*.js",
    "tests/**/*.js",
    "scripts/**",
    "playwright.config.ts",
    "vite.config.ts"
  ]),
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off"
    }
  }
]);
