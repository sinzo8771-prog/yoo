/**
 * Task 22, Step 4 — the media plan and its licence record.
 *
 * Every image is generated from `scripts/catalog/art.ts` by
 * `scripts/generate-catalog-media.ts`. That is not a shortcut around Step 4, it
 * is what makes Step 4 answerable: this repository holds no licensed product
 * photography and no rights to a supplier's images, so any photograph shipped
 * here would have an unverifiable provenance. Generated artwork has a record
 * that is actually true.
 *
 * What each entry must carry (checked by `scripts/catalog/validate.ts` against
 * the bytes on disk, not against this file):
 *  - a real file under `store/public/images/catalog/`, served from the
 *    storefront's own origin, with the declared size, byte count and sha256;
 *  - alt text that says what is in the image, and says out loud that it is an
 *    illustration — a stand-in must not be described as a photograph;
 *  - `source` and `licence`, which the seeder copies into
 *    `ProductImage.metadata` so the record lives with the row.
 *
 * `placeholder: true` is the honest status: these files are brand artwork, and
 * `docs/catalog/media-sources.md` names the step that replaces them.
 */
import type { BackdropKey, MotifKey, PaletteKey, ViewKey } from "./art";
import { PRODUCTS } from "./products";

/** Edge length of every catalog file, in px. Square: the grids are 1:1. */
export const MEDIA_SIZE = 1000;
/** Public directory the storefront serves these from (root-relative URLs). */
export const MEDIA_PUBLIC_DIR = "public/images/catalog";
/** URL prefix the database stores in `ProductImage.imagePath`. */
export const MEDIA_URL_PREFIX = "/images/catalog";
/**
 * Per-file ceiling. Well above what flat artwork costs (≈6-21 KB today) and far
 * below anything that would dominate a page-weight budget.
 */
export const MAX_IMAGE_BYTES = 120 * 1024;

export const ARTWORK_SOURCE =
  "Original artwork authored for Northwind Goods and rendered by scripts/generate-catalog-media.ts. No supplier photograph, stock image or third-party asset is used.";
export const ARTWORK_LICENCE =
  "© Northwind Goods. Authored in this repository for use on this store; not a photograph of a sourced item.";
export const PLACEHOLDER_REASON =
  "Brand artwork standing in for product photography: the sourced item has not been photographed. Replace with the real photograph, re-running the same Step 4 checks (dimensions, alt text, file size, licence record), before launch.";

export type MediaEntry = {
  productKey: string;
  /** 0 is the primary image and the one a product card shows. */
  order: number;
  view: ViewKey;
  motif: MotifKey;
  palette: PaletteKey;
  backdrop: BackdropKey;
  /** Repo-relative path, from the store package root. */
  file: string;
  /** The root-relative URL written to `ProductImage.imagePath`. */
  url: string;
  altText: string;
  source: string;
  licence: string;
  placeholder: boolean;
  placeholderReason?: string;
};

type MediaPlan = {
  motif: MotifKey;
  palette: PaletteKey;
  backdrop: BackdropKey;
  front: string;
  detail: string;
};

/** One motif/palette/backdrop per product, plus the two alt texts. */
const PLAN: Record<string, MediaPlan> = {
  stoneware_utensil_crock: {
    motif: "crock",
    palette: "stoneware",
    backdrop: "paper",
    front:
      "Illustration: a wide-mouthed stoneware utensil crock with two utensils standing upright in it.",
    detail:
      "Illustration: close view of the glazed rim and the flat unglazed foot of the stoneware utensil crock.",
  },
  stoneware_mug: {
    motif: "mug",
    palette: "stoneware",
    backdrop: "paper",
    front:
      "Illustration: a straight-sided stoneware mug with a reactive glaze and a low handle.",
    detail:
      "Illustration: close view of the mug's glazed wall and the join where its handle meets the body.",
  },
  stoneware_serving_bowl: {
    motif: "bowl",
    palette: "stoneware",
    backdrop: "stone",
    front:
      "Illustration: a shallow stoneware serving bowl with a wide rim, seen from slightly above.",
    detail:
      "Illustration: close view of the serving bowl's rim and the curve of its inner surface.",
  },
  stoneware_pitcher: {
    motif: "pitcher",
    palette: "stoneware",
    backdrop: "paper",
    front:
      "Illustration: a one-litre stoneware pitcher with a pinched pouring lip and a handle.",
    detail: "Illustration: close view of the stoneware pitcher's pinched pouring lip.",
  },
  oak_serving_board: {
    motif: "board",
    palette: "oak",
    backdrop: "sand",
    front:
      "Illustration: a tall solid oak serving board with a hanging hole at the top and a juice groove.",
    detail:
      "Illustration: close view of the oak serving board's grain and the edge of its juice groove.",
  },
  oak_cutting_board: {
    motif: "cuttingBoard",
    palette: "oak",
    backdrop: "sand",
    front: "Illustration: an end-grain oak cutting board with a hanging hole at one end.",
    detail:
      "Illustration: close view of the cutting board's end-grain blocks and its chamfered edge.",
  },
  oak_salt_cellar: {
    motif: "cellar",
    palette: "oak",
    backdrop: "paper",
    front: "Illustration: a small lidded oak salt cellar standing on a worktop.",
    detail:
      "Illustration: close view of the salt cellar's oak lid and the knob used to lift it.",
  },
  oak_trivet: {
    motif: "trivet",
    palette: "oak",
    backdrop: "sand",
    front: "Illustration: a round slatted oak trivet with five slats set into a frame.",
    detail: "Illustration: close view of the trivet's slats and the recess they sit in.",
  },
  washed_linen_apron: {
    motif: "apron",
    palette: "linen",
    backdrop: "paper",
    front:
      "Illustration: a cross-back washed linen apron with a low pocket and waist ties.",
    detail:
      "Illustration: close view of the apron's cloth and the stitched edge of its pocket.",
  },
  linen_tea_towels: {
    motif: "towelStack",
    palette: "linen",
    backdrop: "stone",
    front: "Illustration: a folded stack of washed linen tea towels.",
    detail: "Illustration: close view of the folded tea towel stack and its woven hem.",
  },
  linen_table_runner: {
    motif: "runner",
    palette: "linen",
    backdrop: "sand",
    front:
      "Illustration: a washed linen table runner folded lengthways, with a fringed end.",
    detail: "Illustration: close view of the table runner's hem and fringe.",
  },
  linen_napkins: {
    motif: "napkinStack",
    palette: "linen",
    backdrop: "stone",
    front: "Illustration: a stack of folded washed linen napkins.",
    detail:
      "Illustration: close view of the napkins' hemmed edge and the fold between them.",
  },
};

/** Two images per product: the object, then a close view of the same object. */
export const MEDIA: MediaEntry[] = PRODUCTS.flatMap((product) => {
  const plan = PLAN[product.key];
  if (!plan) return [];
  return [
    { view: "front" as const, order: 0, altText: plan.front },
    { view: "detail" as const, order: 1, altText: plan.detail },
  ].map(({ view, order, altText }) => {
    const file = `${product.handle}-${order + 1}-${view}.png`;
    return {
      productKey: product.key,
      order,
      view,
      motif: plan.motif,
      palette: plan.palette,
      backdrop: plan.backdrop,
      file: `${MEDIA_PUBLIC_DIR}/${file}`,
      url: `${MEDIA_URL_PREFIX}/${file}`,
      altText,
      source: ARTWORK_SOURCE,
      licence: ARTWORK_LICENCE,
      placeholder: true,
      placeholderReason: PLACEHOLDER_REASON,
    };
  });
});

/** Media for one product, primary image first. */
export function mediaForProduct(productKey: string): MediaEntry[] {
  return MEDIA.filter((entry) => entry.productKey === productKey).sort(
    (a, b) => a.order - b.order
  );
}
