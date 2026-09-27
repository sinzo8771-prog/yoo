# Catalog media sources

**Plan task:** Task 22, Step 4 (validate images: dimensions, alt text, file
size, licensing/source record).

This is the licensing/source record Step 4 requires. It states what the
storefront's product images are, where they came from, who may use them, and
what must happen before launch.

## What the files are

24 PNG files (2 per product × 12 products) under
`store/public/images/catalog/`, named `<handle>-<n>-<front|detail>.png`:

- **Authored illustration, not photography.** Every file is rendered from scene
  data in `store/scripts/catalog/art.ts` by
  `npm run media:catalog` (`store/scripts/generate-catalog-media.ts`), using the
  dependency-free PNG encoder in `store/scripts/catalog/png.ts`.
- **Front + detail of the same object.** `front` shows the whole item; `detail`
  is a zoom of the same motif, so the second gallery image never invents a new
  view of an item nobody has photographed.
- **Square, 1000 × 1000 px**, ≤ 120 KB each (`MAX_IMAGE_BYTES`); today they are
  ≈6–21 KB.
- **Deterministic.** The same plan always produces byte-identical output, so
  `validate:catalog -- --strict` can prove the file on disk is exactly what the
  committed scene data renders — and the sha256 stored in
  `ProductImage.metadata` identifies these bytes.

## Source and licence (per file)

- **Source:** original artwork authored for Northwind Goods and rendered by
  `scripts/generate-catalog-media.ts`. No supplier photograph, stock image or
  third-party asset is used. (Stored verbatim as `metadata.source`.)
- **Licence:** © Northwind Goods. Authored in this repository for use on this
  store; not a photograph of a sourced item. (Stored verbatim as
  `metadata.licence`.)
- **Alt text:** every placeholder alt text begins `"Illustration:"` and
  describes what is actually drawn. A stand-in is never described as a
  photograph of the product.

The per-product plan (motif, palette, backdrop, both alt texts) lives in
`store/scripts/catalog/media.ts`; the constants above
(`ARTWORK_SOURCE`, `ARTWORK_LICENCE`, `PLACEHOLDER_REASON`) are the strings this
record and the database quote.

## Verification (not trust)

`npm run validate:catalog -- --strict` checks every file **on disk**:

1. exists, decodes as PNG, is exactly 1000 × 1000 (read from IHDR, not assumed);
2. within the 120 KB budget;
3. byte-identical to a fresh render of its plan entry (placeholders only — a
   future photograph's bytes are not re-renderable, so that check stops applying
   exactly when `placeholder` flips to `false`);
4. alt text present and honest, source/licence/reason present;
5. reports the measured byte count and sha256 of each file.

The same checks are covered by
`store/tests/unit/catalog/catalog-validation.test.ts` (strict run against a
scratch directory) and `catalog-art.test.ts` (motif invariants, determinism,
PNG round-trip).

## Honest status: placeholder

Every entry currently carries `placeholder: true` with this reason (stored as
`metadata.placeholderReason`):

> Brand artwork standing in for product photography: the sourced item has not
> been photographed. Replace with the real photograph, re-running the same Step
> 4 checks (dimensions, alt text, file size, licence record), before launch.

## When real photography exists, replace (do not quietly keep the stand-in)

1. Photograph the **sourced** item (the exact variant a supplier sells).
2. In `store/scripts/catalog/media.ts`: point the entry at the photo, set
   `placeholder: false`, replace `source`/`licence` with the photo's record
   (shoot date, photographer/rights), and rewrite the alt text to describe the
   photograph (drop the `"Illustration:"` prefix).
3. Drop the file into `store/public/images/catalog/` under the planned name —
   for a non-placeholder entry the generator no longer owns the bytes.
4. Run `npm run media:catalog` (regenerates the remaining placeholders), then
   `npm run validate:catalog -- --strict`, then `npm run seed:catalog` so the
   database's `image_filesize`/`sha256`/licence metadata tracks the new bytes.

Keeping `placeholder: true` artwork after launch, clearly labelled, is
preferable to a photograph whose rights or subject we cannot vouch for.
