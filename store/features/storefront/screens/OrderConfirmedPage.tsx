import { TrackEvent } from "@/components/analytics/TrackEvent"
import { retrieveOrder } from "@/features/storefront/lib/data/orders"
import OrderCompletedTemplate from "@/features/storefront/modules/order/templates/order-completed-template"
import { toMinorUnits } from "@/lib/format/money"
import { buildPrivateMetadata } from "@/lib/seo/metadata"
import { notFound } from "next/navigation"
import type { StoreOrder } from "@/features/storefront/types/storefront"
import SkeletonOrderConfirmed from "@/features/storefront/modules/skeletons/templates/skeleton-order-confirmed"

// Add searchParams to Props
type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

/**
 * Task 19, Steps 1 + 2: an order confirmation is personal. It is `noindex`, it is
 * not in the sitemap, and robots disallows the whole `/order` prefix.
 */
export const metadata = buildPrivateMetadata("Order Confirmed")

// Update function signature to accept searchParams
export async function OrderConfirmedPage({ params: paramsPromise, searchParams: searchParamsPromise }: Props) {
  const params = await paramsPromise
  const searchParams = await searchParamsPromise

  // Extract secretKey (assuming it's passed as 'key')
  const secretKey = typeof searchParams?.secretKey === 'string' ? searchParams.secretKey : null

  // Call retrieveOrder with id and secretKey
  const order: StoreOrder | null = await retrieveOrder(params.id, secretKey).catch(() => null)

  if (!order) {
    return notFound()
  }

  /*
    Task 19, Step 3 + 4: two observations of the same conversion.
      - `checkout_success` is the provider-confirmation side;
      - `purchase` is the funnel stage that feeds the conversion measure.
    Only the currency and a minor-unit total are sent — never the order id, the
    customer email or the shipping address. `toMinorUnits` returns undefined for
    an absent/unparseable total, so no fabricated revenue is ever reported.
  */
  const currency = order.region?.currency?.code ?? undefined
  const valueMinor = toMinorUnits(order.total, currency)
  const conversionProps = {
    ...(currency ? { currency } : {}),
    ...(valueMinor !== undefined ? { valueMinor } : {}),
  }

  return (
    <>
      <TrackEvent event="checkout_success" props={conversionProps} />
      <TrackEvent event="purchase" props={conversionProps} />
      <OrderCompletedTemplate order={order} />
    </>
  )
}

export function OrderConfirmedLoading() {
  return <SkeletonOrderConfirmed />
}
