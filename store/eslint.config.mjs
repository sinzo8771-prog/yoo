/**
 * ESLint flat config.
 *
 * `eslint-config-next@16` ships **flat** configs (`eslint-config-next/core-web-vitals`
 * and `eslint-config-next/typescript`). The scaffold's `FlatCompat.extends("next/…")`
 * form is what broke `npm run lint`: the package no longer exposes `./next/*`
 * subpaths, so compat resolved the flat array and died with
 * "Converting circular structure to JSON" — a hard crash (exit 2), not a lint
 * result. Import the flat configs directly instead.
 *
 * `next lint` itself is gone in Next 16 (it exits 1 with
 * "Invalid project directory provided … \store\lint"), so the `lint` script runs
 * `eslint` directly. Verified with ESLint 9.29.0 / eslint-config-next 16.0.3.
 */
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

/** Machine-written or vendored code: not ours to lint, and it is not small. */
const IGNORED = [
  ".next/**",
  "node_modules/**",
  // Prisma client output (`prisma generate` writes thousands of files here).
  "generated/**",
  "next-env.d.ts",
];

export default [
  { ignores: IGNORED },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      // Unused args are legitimate in interface implementations and test stubs.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

