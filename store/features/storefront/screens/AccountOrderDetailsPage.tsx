import { TrackEvent } from "@/components/analytics/TrackEvent"
import { retrieveOrder } from "@/features/storefront/lib/data/orders"
import OrderDetailsTemplate from "@/features/storefront/modules/order/templates/order-details-template"
import { buildPrivateMetadata } from "@/lib/seo/metadata"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import type { StoreOrder } from '@/features/storefront/types/storefront'

type Props = {
  params: Promise<{ id: string }>
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params
  // Fetch order using the updated retrieveOrder, passing null for secretKey
  const order: StoreOrder | null = await retrieveOrder(params.id, null).catch(() => null)

  if (!order) {
    notFound()
  }

  // Task 19, Steps 1 + 2: an order page is personal — always `noindex`, never in
  // the sitemap (the `/account` and `/order` prefixes are disallowed as well).
  return buildPrivateMetadata(`Order #${order.displayId}`)
}

export async function AccountOrderDetailsPage(props: Props) {
  const params = await props.params
  // Fetch order using the updated retrieveOrder, passing null for secretKey
  const order: StoreOrder | null = await retrieveOrder(params.id, null).catch(() => null)

  if (!order) {
    notFound()
  }

  return (
    <>
      {/* Task 19, Step 3: the order reference is deliberately not sent. */}
      <TrackEvent event="view_order" />
      <OrderDetailsTemplate order={order} />
    </>
  )
}
