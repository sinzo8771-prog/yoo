import { Metadata } from "next";

import BrandStory from "@/components/home/BrandStory";
import FAQ from "@/components/home/FAQ";
import FeaturedCollection from "@/components/home/FeaturedCollection";
import Hero from "@/components/home/Hero";
import TrustSection from "@/components/home/TrustSection";
import { getStore } from "@/features/storefront/lib/data/store";
import { site } from "@/lib/brand/site";
import {
  getCollectionBySlug,
  getFeaturedProducts,
} from "@/lib/openfront/catalog";

export async function generateMetadata(): Promise<Metadata> {
  const store = await getStore();

  return {
    title: store?.homepageTitle || site.name,
    description: store?.homepageDescription || site.tagline,
  };
}

/**
 * Home page (Task 5).
 *
 * Reads the catalog through our own client (`lib/openfront/catalog`) rather than
 * the reference client's region-scoped queries. This matters: the reference
 * implementation returns `null` — a blank page — whenever no Region row exists
 * for the country code, and it also silently hides products whose prices are not
 * region-scoped. Our client needs neither.
 *
 * Section order: hero → curated products → brand story → trust → FAQ.
 */
export async function HomePage() {
  // Fail soft: a catalog outage should degrade the home page to its editorial
  // content, not throw a 500 at the storefront's front door.
  let products: Awaited<ReturnType<typeof getFeaturedProducts>> = [];
  try {
    products = await getFeaturedProducts(4);
  } catch (error) {
    console.error("Home page: featured products unavailable", error);
  }

  // Secondary hero CTA only when the catalog gives us a collection that exists,
  // labelled with the merchant-authored collection title (never a prettified
  // handle, which would invent a name the merchant never chose).
  const collectionHandle = products
    .flatMap((p) => p.collectionHandles)
    .filter((handle): handle is string => Boolean(handle))[0];

  let heroCollection: { handle: string; title: string } | null = null;
  if (collectionHandle) {
    try {
      const collection = await getCollectionBySlug(collectionHandle, 1);
      if (collection.title) {
        heroCollection = { handle: collectionHandle, title: collection.title };
      }
    } catch (error) {
      console.error("Home page: collection lookup failed", error);
    }
  }

  return (
    <>
      <Hero collection={heroCollection} />
      <FeaturedCollection products={products} />
      <BrandStory />
      <TrustSection />
      <FAQ />
    </>
  );
}
