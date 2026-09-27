/**
 * Task 15, Step 3 (shipping/returns) + Task 21, Step 1 (privacy/terms) —
 * policy content single source of truth.
 *
 * Policies must match operational capability. Every claim below is traceable to
 * code or an ops doc (see `docs/legal/content-source.md`, which records the
 * source of each one):
 *  - The store sells in one market (US/USD) and fulfills through a supplier
 *    channel, so the shipping policy says exactly that — no invented transit
 *    guarantees, no invented carrier promises.
 *  - There is no automated returns portal; returns are handled by email via
 *    support, and the policy says so rather than implying self-service.
 *  - Privacy describes what this application actually stores: account fields
 *    and addresses in the commerce backend, the two cookies in
 *    `features/storefront/lib/data/cookies.ts`, and opt-in first-party
 *    analytics that carry no personal data (`lib/analytics/client.ts`).
 *  - Terms describe the real ordering mechanics: prices read at request time,
 *    payment settled by the checkout provider *before* an order exists
 *    (`docs/ops/payments.md`), cancellation by email.
 *  - Deliberately absent: registered entity name, postal address and governing
 *    jurisdiction. Those are facts only the business can supply and inventing
 *    one would be a false statement to a customer. `docs/legal/content-source.md`
 *    lists them as operator inputs; nothing here prints a placeholder.
 */

import { site } from "./site";

export type PolicySection = {
  heading: string;
  paragraphs: string[];
};

export type Policy = {
  slug: "shipping" | "returns" | "privacy" | "terms";
  title: string;
  summary: string;
  sections: PolicySection[];
};

export const policies: Record<Policy["slug"], Policy> = {
  shipping: {
    slug: "shipping",
    title: "Shipping",
    summary: "Where we ship, what it costs, and how tracking works.",
    sections: [
      {
        heading: "Where we ship",
        paragraphs: [
          "We currently ship to the United States only. If checkout does not accept your address, that is why — we would rather say so plainly than take an order we cannot deliver.",
        ],
      },
      {
        heading: "What shipping costs",
        paragraphs: [
          "Shipping options and prices are shown at checkout before you pay. The price you see there is the price you are charged — shipping is not added later.",
          "Orders above the free-shipping threshold shown at checkout ship free with the options displayed at checkout.",
        ],
      },
      {
        heading: "How long it takes",
        paragraphs: [
          "After you place an order, we arrange shipment with our supplier. Until the carrier accepts the parcel, your order shows as processing in your account.",
          "Once a tracking number is active, delivery estimates come from the carrier itself, shown on your order page. We do not promise transit times we cannot verify.",
        ],
      },
      {
        heading: "Tracking your order",
        paragraphs: [
          "Every order is visible in your account with its current status. Tracking appears there once the supplier's label has been created and the carrier has accepted the parcel.",
          "It is normal for a newly accepted order to have no tracking yet. If your order has been accepted but tracking has not appeared after 48 hours, email support and we will look into it.",
        ],
      },
      {
        heading: "If something goes wrong",
        paragraphs: [
          "If a package is delayed, damaged, or appears lost, email support with your order number. We work with the carrier and supplier to resolve it, and we will tell you honestly what happened rather than leaving the tracking page to speak for us.",
        ],
      },
    ],
  },
  returns: {
    slug: "returns",
    title: "Returns",
    summary: "How to send something back and what to expect.",
    sections: [
      {
        heading: "The short version",
        paragraphs: [
          "If an item is not right, you have 30 days from delivery to return it. It should be unused and in its original packaging. Email support with your order number and we will take it from there.",
        ],
      },
      {
        heading: "How to start a return",
        paragraphs: [
          "There is no online returns portal — every return starts with an email to support. That is deliberate: it lets us give you the correct return address and instructions for your specific item instead of guessing.",
          "Include your order number and, if you can, a line about what was wrong. We reply with return instructions.",
        ],
      },
      {
        heading: "Refunds",
        paragraphs: [
          "Once the item arrives back and passes a basic inspection, we refund the item's price to your original payment method. Shipping charges are refunded only when the item arrived damaged or was not what you ordered.",
          "If an item arrives damaged or incorrect, tell us within 7 days of delivery and we will make it right — a replacement or a full refund, your choice where we can offer one.",
        ],
      },
      {
        heading: "What we cannot accept",
        paragraphs: [
          "Items that have been used, installed, or are missing parts cannot be returned unless they arrived damaged or defective. If you are unsure whether your situation qualifies, ask — we would rather answer the question than have you guess.",
        ],
      },
    ],
  },

  privacy: {
    slug: "privacy",
    title: "Privacy",
    summary: "What this store holds about you, what it never sees, and how to ask us to change or remove it.",
    sections: [
      {
        heading: "What we hold",
        paragraphs: [
          "If you create an account we ask for your first and last name, your email address and a password. A phone number is optional. We hold those details in our commerce system so that you can sign in and see your own orders.",
          "When you place an order we also hold the delivery address you entered, the items you bought, and the reference our payment provider gives us for the payment. We cannot ship or support an order without them.",
          "You can browse and build a cart without an account — but a cart is still a record on our side, linked to your browser by a cookie rather than to a name.",
        ],
      },
      {
        heading: "What we never see",
        paragraphs: [
          "We never see or store your card number, its security code, or any password for a payment or wallet account. Those are entered with our payment provider. What comes back to us is a reference to the payment, not the payment instrument itself.",
        ],
      },
      {
        heading: "Cookies we set",
        paragraphs: [
          "This site sets two cookies, and both are read only by this site: a cart cookie that keeps your cart attached to your browser for seven days, and a session cookie that keeps you signed in for thirty days after you sign in.",
          "We set no advertising cookies, no cross-site tracking cookies and no third-party analytics cookies. No third-party script is loaded on this site.",
        ],
      },
      {
        heading: "Analytics",
        paragraphs: [
          "Site analytics is off by default. When it is switched on it is first-party — events are sent to our own domain, with no cookie and no visitor identifier attached.",
          "Those events carry only facts about a visit, from a fixed list: which page was viewed, a product or collection handle, a cart value. No email, name, phone, street address, postal code, card or payment data, IP address, order number, session or cookie id, user agent, referrer URL or search term is recorded.",
          "If your browser sends Do Not Track or Global Privacy Control, analytics stays off for you — the setting is re-checked on every event, so turning it on mid-visit takes effect immediately. Because no identifier is stored, analytics cannot be used to describe an individual visitor.",
        ],
      },
    ],
  },

  terms: {
    slug: "terms",
    title: "Terms",
    summary: "The rules that apply when you order from this store, in plain terms.",
    sections: [
      {
        heading: "Who you are ordering from",
        paragraphs: [
          `This store is operated under the name ${site.name}. When you order here you are ordering from us, not from the suppliers and carriers that help us fulfil the order. Our contact details are in the footer and on every policy page.`,
        ],
      },
      {
        heading: "Prices, stock and what you pay",
        paragraphs: [
          "Prices, currencies and stock are read from our catalog system when a page loads, so they can change between visits. The price shown at checkout is the price you are charged, and shipping is not added after the payment.",
          "If an item sells out between your cart and checkout, checkout will not let you order it — we would rather refuse the sale than take an order we cannot fulfil.",
        ],
      },
      {
        heading: "Paying for an order",
        paragraphs: [
          "Payment is taken by our payment provider at the end of checkout, and the methods available to you are the ones listed there.",
          "If the payment does not settle, no order is created and nothing is charged: a declined payment leaves no order behind and no amount owed.",
        ],
      },
      {
        heading: "Cancelling an order",
        paragraphs: [
          "An order exists once payment has settled and you can see it in your account. To cancel one, email support with your order number.",
          "If the order has not been dispatched we cancel it and refund the payment to the method it came from. The cancellation is not complete until that refund reaches your payment method — how long that takes is set by your provider, not by us. If the order has already been dispatched it becomes a return, and our Returns policy applies.",
        ],
      },
      {
        heading: "Shipping and returns",
        paragraphs: [
          "Delivery is covered by our Shipping policy: where we ship, what shipping costs, and what tracking can and cannot tell you.",
          "Returns, refunds and items that arrived damaged or incorrect are covered by our Returns policy. Both policies are linked below and in the footer of every page.",
        ],
      },
      {
        heading: "Using this site",
        paragraphs: [
          "You may browse and order for your own personal use. Please do not try to disrupt the site, attack it, or scrape it in bulk — automated traffic is rate-limited, and we will block it when it is abusive.",
          "The product photography, descriptions, layout and code on this site belong to us or are used with permission. They may not be copied to build a competing store.",
        ],
      },
      {
        heading: "Our responsibility for an order",
        paragraphs: [
          "Nothing in these terms removes a right you have under consumer law, including the right to receive goods that match their description.",
          "Beyond that, our responsibility for an order is limited to what that order cost you. We cannot promise a delivery date on the carrier's behalf, and we do not invent one — what we can tell you about tracking is in the Shipping policy.",
        ],
      },
      {
        heading: "Changes and questions",
        paragraphs: [
          "The version of these terms published on this page applies to an order placed after it appears here. If we change something that affects orders, the change is published here.",
          "If you are a consumer, nothing here removes rights you have where you live. If something about an order is wrong, email support first — we would rather fix the problem than argue about wording.",
        ],
      },
    ],
  },
};

/**
 * Slugs that exist today, in the order they are listed. Anything else must 404,
 * not render an empty page — and `Object.keys(policies)` keeps this in step with
 * the record by construction, so a new policy cannot be forgotten here.
 */
export const availablePolicySlugs = Object.keys(policies) as Policy["slug"][];
