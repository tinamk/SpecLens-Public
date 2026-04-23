import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    "node_modules/**",
    "**/next-env.d.ts",
    "dist/**",
    ".next/**",
    "**/.next/**",
    ".speclens-workspace/**",
    "coverage/**",
    "generated/**",
    "playwright-report/**",
    "reports/**",
    "test-results/**",
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
  },
  {
    files: ["eslint.config.js"],
    plugins: {
      "@next/next": nextPlugin,
    },
    settings: {
      next: {
        rootDir: "apps/web/",
      },
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
    },
    settings: {
      next: {
        rootDir: "apps/web/",
      },
    },
    rules: {
      ...nextPlugin.configs["core-web-vitals"].rules,
      "@next/next/no-html-link-for-pages": "off",
    }
  }
]);
