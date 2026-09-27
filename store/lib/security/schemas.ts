/**
 * Task 18 — zod schemas for the storefront's untrusted-data boundaries.
 *
 * The storefront runs *against* Openfront: everything it reads from the backend
 * GraphQL API is untrusted input at an API boundary and is validated before use
 * — typed access, bounded lengths, and defaults, so a hostile or simply broken
 * upstream record cannot inject markup (see `lib/security/markup.ts`) or crash a
 * render. Invalid records are rejected as a whole rather than partially trusted;
 * `getStore()` then falls back to the brand config, which keeps the storefront
 * rendering instead of throwing.
 */

import { z } from "zod";

/** Longest plain-text store field we accept (title, description). */
export const MAX_STORE_TEXT_LENGTH = 4000;

/** Longest markup store field we accept; mirrors `MAX_SVG_LENGTH`. */
export const MAX_STORE_MARKUP_LENGTH = 20_000;

/** Longest provider base URL accepted before the SSRF guard sees it. */
export const MAX_PROVIDER_URL_LENGTH = 2048;

/**
 * Openfront `Store` record. Unknown fields are preserved (`passthrough`) so a
 * backend addition does not invalidate an otherwise fine record, but their
 * values stay `unknown` — consumers must validate before using them.
 */
export const storeRecordSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().max(200).nullish(),
    defaultCurrencyCode: z.string().min(2).max(8).nullish(),
    homepageTitle: z.string().max(MAX_STORE_TEXT_LENGTH).nullish(),
    homepageDescription: z.string().max(MAX_STORE_TEXT_LENGTH).nullish(),
    logoIcon: z.string().max(MAX_STORE_MARKUP_LENGTH).nullish(),
    // Stored as a numeric string by the backend, but numbers are accepted and
    // normalized; the value is still clamped before it becomes CSS.
    logoColor: z
      .union([z.string().max(16), z.number().finite()])
      .nullish()
      .transform((value) =>
        value === null || value === undefined ? undefined : String(value)
      ),
    metadata: z.unknown().nullish(),
  })
  .passthrough();

export type StoreRecord = z.infer<typeof storeRecordSchema>;

/** Provider base URL as it arrives from configuration. */
export const providerUrlSchema = z.string().trim().min(1).max(MAX_PROVIDER_URL_LENGTH);

/**
 * Validate one store record. Returns null (with a path-only warning — never the
 * values) when the record cannot be trusted.
 */
export function parseStoreRecord(raw: unknown): StoreRecord | null {
  const result = storeRecordSchema.safeParse(raw);
  if (result.success) return result.data;
  if (process.env.NODE_ENV !== "test") {
    console.warn(
      "[security] rejected store record from Openfront at path(s):",
      result.error.issues.map((issue) => issue.path.join(".") || "(root)").join(", ")
    );
  }
  return null;
}

/** Validate a provider base URL string, or null when it is not usable. */
export function parseProviderUrl(raw: unknown): string | null {
  const result = providerUrlSchema.safeParse(raw);
  return result.success ? result.data : null;
}
