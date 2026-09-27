/**
 * Task 22, Step 4 — render the media plan to real PNG files.
 *
 *   npm run media:catalog        (write/refresh every planned file)
 *
 * For each `MEDIA` entry this renders `scripts/catalog/art.ts` and writes the
 * bytes under `store/public/images/catalog/`, refusing to write anything that
 * fails the same checks `scripts/catalog/validate.ts --strict` will run later
 * (square 1000px PNG, within the byte budget). Rendering is deterministic, so
 * re-running never churns files in git unless the art actually changed — which
 * is exactly what makes the recorded sha256 meaningful.
 *
 * Exports `generateMedia` so tests can render a subset into a temp directory
 * and drive the strict validator without touching the repository's files.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { renderArtwork } from "./catalog/art";
import {
  MAX_IMAGE_BYTES,
  MEDIA,
  MEDIA_SIZE,
  type MediaEntry,
} from "./catalog/media";
import { readPngSize } from "./catalog/png";

export type MediaFileRecord = {
  entry: MediaEntry;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
};

export type GenerateOptions = {
  /** Store package root (media paths are relative to it). Defaults to cwd. */
  rootDir?: string;
  /** Entries to render; defaults to the whole plan. */
  entries?: readonly MediaEntry[];
};

/** Render + verify + write. Throws if a render would violate the media budget. */
export function generateMedia(options: GenerateOptions = {}): MediaFileRecord[] {
  const rootDir = options.rootDir ?? process.cwd();
  const entries = options.entries ?? MEDIA;
  const records: MediaFileRecord[] = [];

  for (const entry of entries) {
    const png = renderArtwork({
      motif: entry.motif,
      palette: entry.palette,
      backdrop: entry.backdrop,
      view: entry.view,
      size: MEDIA_SIZE,
    });

    const { width, height } = readPngSize(png);
    if (width !== MEDIA_SIZE || height !== MEDIA_SIZE) {
      throw new Error(`${entry.file}: rendered ${width}x${height}, expected ${MEDIA_SIZE}x${MEDIA_SIZE}`);
    }
    if (png.length > MAX_IMAGE_BYTES) {
      throw new Error(
        `${entry.file}: ${png.length} bytes exceeds the ${MAX_IMAGE_BYTES} byte budget; simplify the artwork rather than raising the budget`
      );
    }

    const absolute = path.resolve(rootDir, entry.file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, png);

    records.push({
      entry,
      bytes: png.length,
      width,
      height,
      sha256: createHash("sha256").update(png).digest("hex"),
    });
  }
  return records;
}

// Only run when executed directly (`tsx scripts/generate-catalog-media.ts`),
// never when tests import `generateMedia`.
const invoked = (process.argv[1] ?? "").replace(/\\/g, "/");
if (invoked.endsWith("/scripts/generate-catalog-media.ts")) {
  const records = generateMedia();
  const total = records.reduce((sum, record) => sum + record.bytes, 0);
  for (const record of records) {
    console.log(
      `  ${record.entry.file}  ${record.width}x${record.height}  ` +
        `${record.bytes} bytes  sha256 ${record.sha256.slice(0, 16)}…`
    );
  }
  console.log(
    `Wrote ${records.length} file(s), ${(total / 1024).toFixed(1)} KB total. ` +
      `Validate with \`npm run validate:catalog\`.`
  );
}
