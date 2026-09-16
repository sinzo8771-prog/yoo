import { ProductDetailScreen } from "@/features/products/screens/ProductDetailScreen";
import { Metadata } from "next";
import { getProductBySlug } from "@/lib/openfront/catalog";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ countryCode: string; handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const product = await getProductBySlug(handle);
  if (!product) {
    return { title: "Product not found" };
  }
  return {
    title: product.title,
    description: product.subtitle ?? product.description ?? undefined,
    openGraph: {
      title: product.title,
      description: product.subtitle ?? product.description ?? undefined,
      images: product.images.length > 0 ? [product.images[0].url] : undefined,
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ countryCode: string; handle: string }>;
}) {
  const { countryCode, handle } = await params;
  return <ProductDetailScreen handle={handle} countryCode={countryCode} />;
}

