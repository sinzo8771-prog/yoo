import ItemsTemplate from "./items"
import Summary from "./summary"
import EmptyCartMessage from "../components/empty-cart-message"
import SignInPrompt from "../components/sign-in-prompt"
import Divider from "@/features/storefront/modules/common/components/divider"
import LocalizedClientLink from "@/features/storefront/modules/common/components/localized-client-link"
import { site } from "@/lib/brand/site"

interface CartTemplateProps {
  cart?: {
    id: string;
    lineItems: any[];
    region: any;
  };
  user: any;
}

/**
 * Task 21, Step 2 — the cart is where a shopper decides, so the two policies
 * that change that decision (shipping cost and the return window) are surfaced
 * here. The copy is read from `site.trust.items` rather than retyped, so the
 * cart can never quote a different return window than the Returns page.
 */
function cartPolicyItems() {
  return site.trust.items.filter(
    (item) =>
      item.available &&
      (item.href === "/policies/shipping" || item.href === "/policies/returns")
  )
}

const CartTemplate = ({ cart, user }: CartTemplateProps) => {
  return (
    <div className="py-12">
      <div className="max-w-[1440px] w-full mx-auto px-6" data-testid="cart-container">
        {cart?.lineItems?.length ? (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-y-8 lg:gap-x-12 xl:gap-x-40">
            <div className="flex flex-col bg-background py-6 gap-y-6">
              {!user && (
                <>
                  <SignInPrompt />
                  <Divider />
                </>
              )}
              <ItemsTemplate items={cart.lineItems} region={cart.region} />
              <Divider />
              <section
                aria-labelledby="cart-policies-heading"
                data-testid="cart-policy-notice"
              >
                <h2
                  id="cart-policies-heading"
                  className="text-sm leading-5 font-medium"
                >
                  Before you check out
                </h2>
                <ul className="mt-2 flex flex-col gap-y-2 text-[0.8125rem] leading-5 text-muted-foreground">
                  {cartPolicyItems().map((item) => (
                    <li key={item.href}>
                      <span className="font-medium text-foreground">
                        {item.label}:
                      </span>{" "}
                      {item.body}{" "}
                      <LocalizedClientLink
                        className="underline underline-offset-4 hover:text-foreground"
                        href={item.href}
                      >
                        Read the {item.label.toLowerCase()} policy
                      </LocalizedClientLink>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <div className="relative">
              <div className="flex flex-col gap-y-8 sticky top-12">
                {cart && cart.region && (
                  <>
                    <div className="bg-background py-6">
                      <Summary cart={cart} />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <EmptyCartMessage />
          </div>
        )}
      </div>
    </div>
  )
}

export default CartTemplate

