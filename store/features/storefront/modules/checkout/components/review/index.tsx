"use client"

import { cn } from "@/lib/utils"

import LocalizedClientLink from "@/features/storefront/modules/common/components/localized-client-link"
import PaymentButton from "../payment-button"
import { useSearchParams } from "next/navigation"

const Review = ({ cart }: { cart: any }) => {
  const searchParams = useSearchParams()

  const isOpen = searchParams.get("step") === "review"

  const paidByGiftcard =
    cart?.giftCard && cart?.giftCard?.length > 0 && cart?.total === 0

  const previousStepsCompleted =
    cart?.shippingAddress && // Check shippingAddress
    cart?.shippingMethods?.length > 0 && // Check shippingMethods
    (cart?.paymentCollection || paidByGiftcard) // Check paymentCollection

  return (
    <div className="bg-background">
      <div className="flex flex-row items-center justify-between mb-6">
        <h2 // Use h2
          className={cn(
            "flex flex-row text-3xl font-medium gap-x-2 items-baseline", // Use Tailwind class
            {
              // Disable if not open OR previous steps not completed
              "opacity-50 pointer-events-none select-none": !isOpen || !previousStepsCompleted,
            }
          )}
        >
          Review
        </h2>
      </div>
      {isOpen && previousStepsCompleted && (
        <>
          <div className="flex items-start gap-x-1 w-full mb-6">
            <div className="w-full">
              <p className="text-sm text-foreground mb-1">
                By clicking the Place Order button, you confirm that you have
                read, understand and accept our{" "}
                <LocalizedClientLink
                  href="/policies/terms"
                  className="underline underline-offset-4"
                >
                  Terms
                </LocalizedClientLink>
                , our{" "}
                <LocalizedClientLink
                  href="/policies/returns"
                  className="underline underline-offset-4"
                >
                  Returns policy
                </LocalizedClientLink>{" "}
                and our{" "}
                <LocalizedClientLink
                  href="/policies/privacy"
                  className="underline underline-offset-4"
                >
                  Privacy policy
                </LocalizedClientLink>
                .
              </p>
            </div>
          </div>
          <PaymentButton cart={cart} data-testid="submit-order-button" />
        </>
      )}
    </div>
  )
}

export default Review
