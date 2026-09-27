/**
 * Task 13 Step 3 — match verification.
 *
 * The pinned router does not reject a partially matched order; it purchases
 * exactly the lines that were matched and leaves the rest untouched. Verified
 * in `openship/features/keystone`:
 *
 *  - `extendGraphqlSchema/mutations/matchOrder.ts` builds `ShopItem`s from
 *    `order.lineItems` and `ChannelItem`s from `order.cartItems`, i.e. only the
 *    lines an operator has matched reach the purchase path. An unmatched line
 *    simply never becomes a cart item.
 *  - `matchOrder.ts :: findChannelItems` reuses an existing `ChannelItem`
 *    whenever `(channel, user, quantity, productId, variantId)` already exists.
 *    Two identical source lines therefore collapse into ONE channel item, and
 *    only one of the two quantities is ever bought.
 *  - `lib/placeMultipleOrders.ts` routes `CartItem`s where `purchaseId === ""`
 *    AND `url === ""`, grouped per channel, and each channel call is
 *    all-or-nothing (a mixed cart is rejected at the adapter boundary).
 *
 * This module is the missing guard: it compares what the customer ordered with
 * what is about to be purchased and fails closed on anything short of a full,
 * unambiguous match — unless the configured business rule explicitly allows
 * partial fulfillment, in which case only the fault-free channels may ship.
 *
 * Pure functions: no I/O, no clock, deterministic ordering.
 */

export type SourceLine = {
  lineItemId: string;
  productId: string;
  variantId: string;
  sku?: string | null;
  name?: string | null;
  quantity: number;
};

export type MatchedCartItem = {
  cartItemId: string;
  channelId: string;
  productId: string;
  variantId: string;
  quantity: number;
  /** Set by the router only when the cart item was derived from one line. */
  lineItemId?: string | null;
};

export type MatchPolicy = {
  /**
   * Business rule. `false` (default) rejects the whole order on any deviation
   * from an exact match. `true` permits the fault-free channels to ship while
   * the shortfall stays visible for the operator and the customer.
   */
  allowPartialFulfillment?: boolean;
};

export const MATCH_FAULT = {
  /** A source line identity or quantity cannot be interpreted. */
  INVALID_LINE: "INVALID_LINE",
  /** Customer ordered a variant that no channel matched. */
  UNMATCHED_LINE: "UNMATCHED_LINE",
  /** Matched quantity is below what was ordered. */
  QUANTITY_SHORTFALL: "QUANTITY_SHORTFALL",
  /** Matched quantity exceeds what was ordered — never purchasable. */
  QUANTITY_EXCESS: "QUANTITY_EXCESS",
  /** Cart item with no counterpart in the source order. */
  UNLINKED_CART_ITEM: "UNLINKED_CART_ITEM",
  /** Same `(variantId, quantity)` repeated: the router reuses one ChannelItem. */
  COLLAPSED_SOURCE_LINE: "COLLAPSED_SOURCE_LINE",
  /** One variant fulfilled by more than one channel (double-sourcing). */
  MULTI_CHANNEL_VARIANT: "MULTI_CHANNEL_VARIANT",
} as const;

export type MatchFaultKind = keyof typeof MATCH_FAULT;
export type MatchSeverity = "blocking" | "partial";

export type MatchFault = {
  kind: MatchFaultKind;
  severity: MatchSeverity;
  /** Stable, operator-facing explanation. */
  message: string;
  variantId?: string;
  channelId?: string;
  cartItemId?: string;
  expected?: number;
  matched?: number;
};

export type MatchStatus = "MATCHED" | "PARTIAL" | "INVALID";

export type MatchVerification = {
  status: MatchStatus;
  /** True only when the policy permits every channel listed below. */
  canSubmit: boolean;
  /** Channels holding a complete, uncontested slice of the order. */
  submittableChannelIds: string[];
  faults: MatchFault[];
  shortfalls: { variantId: string; expected: number; matched: number }[];
  summary: string;
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const isIdentity = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Expected quantity per variant across the whole source order. */
function expectedByVariant(lines: SourceLine[]) {
  return lines.reduce((acc, line) => {
    acc.set(line.variantId, (acc.get(line.variantId) ?? 0) + line.quantity);
    return acc;
  }, new Map<string, number>());
}

/** Matched quantity per variant per channel, from the router's cart items. */
function matchedByChannelAndVariant(cartItems: MatchedCartItem[]) {
  const acc = new Map<string, Map<string, number>>();
  for (const item of cartItems) {
    const perChannel = acc.get(item.channelId) ?? new Map<string, number>();
    perChannel.set(item.variantId, (perChannel.get(item.variantId) ?? 0) + item.quantity);
    acc.set(item.channelId, perChannel);
  }
  return acc;
}

export function verifyOrderMatch({
  lines,
  cartItems,
  policy = {},
}: {
  lines: SourceLine[];
  cartItems: MatchedCartItem[];
  policy?: MatchPolicy;
}): MatchVerification {
  const allowPartial = policy.allowPartialFulfillment === true;
  const faults: MatchFault[] = [];

  // --- Source-side validity -------------------------------------------------
  for (const line of lines) {
    if (!isIdentity(line?.variantId) || !isPositiveInteger(line?.quantity)) {
      faults.push({
        kind: MATCH_FAULT.INVALID_LINE,
        severity: "blocking",
        message:
          `Line ${line?.lineItemId ?? "(no id)"} has no usable variant identity or quantity; ` +
          "a purchase cannot be proven for it.",
        variantId: isIdentity(line?.variantId) ? line.variantId : undefined,
      });
    }
  }

  // Duplicate (variantId, quantity) pairs: the pinned findChannelItems reuses
  // one ChannelItem, so the second line is silently not bought.
  const seenPairs = new Set<string>();
  for (const line of lines) {
    if (!isIdentity(line?.variantId) || !isPositiveInteger(line?.quantity)) continue;
    const pair = `${line.variantId}\u0000${line.quantity}`;
    if (seenPairs.has(pair)) {
      faults.push({
        kind: MATCH_FAULT.COLLAPSED_SOURCE_LINE,
        severity: "partial",
        message:
          `${line.variantId} is ordered twice in quantity ${line.quantity}; OpenShip reuses one ` +
          "channel item for identical quantity/variant pairs, so only one of them is purchased.",
        variantId: line.variantId,
      });
    }
    seenPairs.add(pair);
  }

  // --- Cart-item-side validity ---------------------------------------------
  const sourceVariants = new Set(
    lines.filter(l => isIdentity(l?.variantId)).map(l => l.variantId)
  );
  for (const item of cartItems) {
    if (!isIdentity(item?.variantId) || !isPositiveInteger(item?.quantity)) {
      faults.push({
        kind: MATCH_FAULT.INVALID_LINE,
        severity: "blocking",
        message: `Cart item ${item?.cartItemId ?? "(no id)"} has no usable variant or quantity.`,
        cartItemId: item?.cartItemId,
      });
      continue;
    }
    if (!sourceVariants.has(item.variantId)) {
      faults.push({
        kind: MATCH_FAULT.UNLINKED_CART_ITEM,
        severity: "blocking",
        message:
          `Cart item ${item.cartItemId} (${item.variantId}) has no counterpart in the source ` +
          "order; purchasing it would buy something the customer did not order.",
        variantId: item.variantId,
        channelId: item.channelId,
        cartItemId: item.cartItemId,
      });
    }
  }

  // --- Quantity coverage per variant ---------------------------------------
  const expected = expectedByVariant(
    lines.filter(l => isIdentity(l?.variantId) && isPositiveInteger(l?.quantity))
  );
  const matched = matchedByChannelAndVariant(
    cartItems.filter(i => isIdentity(i?.variantId) && isPositiveInteger(i?.quantity))
  );

  const channelsByVariant = new Map<string, Set<string>>();
  for (const item of cartItems) {
    if (!isIdentity(item?.variantId)) continue;
    const set = channelsByVariant.get(item.variantId) ?? new Set<string>();
    set.add(item.channelId);
    channelsByVariant.set(item.variantId, set);
  }

  const shortfalls: { variantId: string; expected: number; matched: number }[] = [];

  for (const variantId of [...expected.keys()].sort(compare)) {
    const wanted = expected.get(variantId) as number;
    const channels = channelsByVariant.get(variantId) ?? new Set<string>();
    if (channels.size > 1) {
      faults.push({
        kind: MATCH_FAULT.MULTI_CHANNEL_VARIANT,
        severity: "blocking",
        message:
          `${variantId} is matched in ${channels.size} channels ` +
          `(${[...channels].sort(compare).join(", ")}); a single line may not be double-sourced.`,
        variantId,
      });
    }
    const bought = [...matched.values()].reduce(
      (total, perChannel) => total + (perChannel.get(variantId) ?? 0),
      0
    );
    if (bought === 0) {
      faults.push({
        kind: MATCH_FAULT.UNMATCHED_LINE,
        severity: "partial",
        message: `${variantId} (x${wanted}) was never matched to a fulfillment channel.`,
        variantId,
        expected: wanted,
        matched: 0,
      });
      shortfalls.push({ variantId, expected: wanted, matched: 0 });
    } else if (bought < wanted) {
      faults.push({
        kind: MATCH_FAULT.QUANTITY_SHORTFALL,
        severity: "partial",
        message: `${variantId} ordered ${wanted} but only ${bought} were matched for purchase.`,
        variantId,
        expected: wanted,
        matched: bought,
      });
      shortfalls.push({ variantId, expected: wanted, matched: bought });
    } else if (bought > wanted) {
      faults.push({
        kind: MATCH_FAULT.QUANTITY_EXCESS,
        severity: "blocking",
        message: `${variantId} ordered ${wanted} but ${bought} were matched; over-purchase is refused.`,
        variantId,
        expected: wanted,
        matched: bought,
      });
    }
  }

  // --- Policy ---------------------------------------------------------------
  const invalid = faults.some(f => f.kind === MATCH_FAULT.INVALID_LINE);
  const alwaysBlocking = faults.some(f => f.severity === "blocking");
  const partialBlocking = faults.some(f => f.severity === "partial");

  // A channel is only excluded by a fault that names that channel. The pinned
  // router submits a channel's whole cart in one adapter call, so a channel
  // holding an unlinked item would purchase it too. Variant-level faults
  // (unmatched, shortfall, collapse) deliberately do NOT exclude a channel:
  // shipping the matched portion of a short line is precisely what
  // `allowPartialFulfillment` authorizes.
  const faultedChannels = new Set(
    faults.map(f => f.channelId).filter((id): id is string => typeof id === "string")
  );
  const candidateChannels = [...matched.keys()]
    .filter(channelId => !faultedChannels.has(channelId))
    .sort(compare);

  const canSubmit = alwaysBlocking
    ? false
    : partialBlocking
      ? allowPartial && candidateChannels.length > 0
      : true;

  // A refused plan exposes no channel to act on.
  const submittableChannelIds = canSubmit ? candidateChannels : [];

  const status: MatchStatus = invalid
    ? "INVALID"
    : partialBlocking || alwaysBlocking
      ? "PARTIAL"
      : "MATCHED";

  const summary = canSubmit
    ? status === "MATCHED"
      ? `Full match: ${expected.size} variant(s) across ${submittableChannelIds.length} channel(s).`
      : `Partial fulfillment approved: submitting ${submittableChannelIds.join(", ")} while ` +
        `${shortfalls.length} variant(s) remain unfulfilled.`
    : `${faults.length} match fault(s) block submission ` +
      `(${[...new Set(faults.map(f => f.kind))].sort(compare).join(", ") || "none"}).`;

  return { status, canSubmit, submittableChannelIds, faults, shortfalls, summary };
}