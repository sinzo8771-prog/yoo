import { TrackEvent } from "@/components/analytics/TrackEvent"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { buildPrivateMetadata } from "@/lib/seo/metadata"
import { redirect } from "next/navigation"

/**
 * Task 19, Steps 1 + 2: a lookup form with no content of its own — `noindex`
 * and excluded from the sitemap.
 */
export const metadata = buildPrivateMetadata("Track order")

/**
 * Task 8, Step 2 — safe order lookup entry point for guests.
 *
 * The Openfront backend only grants guest order access when the request can
 * prove knowledge of the order's `secretKey` (emailed in the confirmation
 * link). This page funnels that proof into the order-confirmed route; it never
 * queries orders by ID alone, and the order ID is shape-validated before the
 * redirect so junk input cannot be forwarded to the backend.
 */
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

type TrackOrderPageProps = {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function TrackOrderPage({ params, searchParams }: TrackOrderPageProps) {
  const { countryCode } = await params
  const { error } = await searchParams

  async function trackOrder(formData: FormData) {
    "use server"

    const locale = String(formData.get("countryCode") || "us")
    const orderId = String(formData.get("orderId") || "").trim()
    const secretKey = String(formData.get("secretKey") || "").trim()

    if (!ORDER_ID_PATTERN.test(orderId) || !secretKey || secretKey.length > 512) {
      redirect(`/${locale}/track?error=1`)
    }

    redirect(
      `/${locale}/order/confirmed/${orderId}?secretKey=${encodeURIComponent(secretKey)}`
    )
  }

  return (
    <div className="flex flex-col items-center w-full px-6 py-12">
      {/* Task 19, Step 3: funnel/diagnostic event — someone started a lookup. */}
      <TrackEvent event="view_tracking" />
      <div className="w-full max-w-md flex flex-col gap-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Track your order</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Enter the order ID and the secret key from your confirmation link or
            email to see the latest status of your order.
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600" data-testid="track-order-error">
            We couldn&apos;t use those details. Check the order ID and secret key
            and try again.
          </p>
        )}

        <form action={trackOrder} className="flex flex-col gap-y-4">
          <input type="hidden" name="countryCode" value={countryCode} />
          <div className="flex flex-col gap-y-1">
            <label htmlFor="orderId" className="text-sm font-medium">
              Order ID
            </label>
            <Input
              id="orderId"
              name="orderId"
              required
              maxLength={64}
              autoComplete="off"
              placeholder="e.g. cmx8k2 Order ID from your email"
              data-testid="track-order-id"
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <label htmlFor="secretKey" className="text-sm font-medium">
              Secret key
            </label>
            <Input
              id="secretKey"
              name="secretKey"
              required
              maxLength={512}
              autoComplete="off"
              placeholder="From your order confirmation link"
              data-testid="track-order-secret"
            />
          </div>
          <Button type="submit" data-testid="track-order-submit">
            Track order
          </Button>
        </form>
      </div>
    </div>
  )
}