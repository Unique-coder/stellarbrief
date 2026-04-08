/**
 * Agent decision functions — pure, no I/O.
 *
 * Each function tells the agent whether a specific paid action is worth
 * taking given the current wallet balance and market conditions.
 * Every call to a paid endpoint costs $0.01 USDC.
 *
 * Rule: after paying, the remaining balance must not drop below MINIMUM_FLOOR.
 *   i.e.  balance - CALL_COST >= MINIMUM_FLOOR
 */

export const CALL_COST = 0.01;       // USDC per x402 endpoint call
export const MINIMUM_FLOOR = 0.05;   // USDC — wallet must never go below this

export interface Decision {
  should: boolean;
  reason: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function hasBudget(balance: number): boolean {
  return balance - CALL_COST >= MINIMUM_FLOOR;
}

// ─── shouldFetchNews ─────────────────────────────────────────────────────────

/**
 * Fetch news only when price is moving meaningfully AND budget allows.
 * @param balance       Current USDC wallet balance
 * @param threshold     Minimum absolute 24h price-change % to justify the call
 * @param priceChange24h 24h price change as a percentage (e.g. 3.5 = +3.5%)
 */
export function shouldFetchNews(
  balance: number,
  threshold: number,
  priceChange24h: number
): Decision {
  const moving = Math.abs(priceChange24h) >= threshold;
  const funded = hasBudget(balance);

  if (!funded) {
    return { should: false, reason: `Insufficient balance: $${balance.toFixed(4)} — need at least $${(MINIMUM_FLOOR + CALL_COST).toFixed(2)}` };
  }
  if (!moving) {
    return { should: false, reason: `Price change ${priceChange24h.toFixed(2)}% is below threshold of ${threshold}% — news not worth fetching` };
  }
  return { should: true, reason: `Price moved ${priceChange24h.toFixed(2)}% (≥ ${threshold}%) and balance $${balance.toFixed(4)} is sufficient` };
}

// ─── shouldFetchSentiment ────────────────────────────────────────────────────

/**
 * Fetch sentiment only when price is moving meaningfully AND budget allows.
 * Sentiment without meaningful movement adds noise over signal.
 * @param balance       Current USDC wallet balance
 * @param threshold     Minimum absolute 24h price-change % to justify the call
 * @param priceChange24h 24h price change as a percentage
 */
export function shouldFetchSentiment(
  balance: number,
  threshold: number,
  priceChange24h: number
): Decision {
  const moving = Math.abs(priceChange24h) >= threshold;
  const funded = hasBudget(balance);

  if (!funded) {
    return { should: false, reason: `Insufficient balance: $${balance.toFixed(4)} — need at least $${(MINIMUM_FLOOR + CALL_COST).toFixed(2)}` };
  }
  if (!moving) {
    return { should: false, reason: `Price change ${priceChange24h.toFixed(2)}% is below threshold of ${threshold}% — sentiment not worth fetching` };
  }
  return { should: true, reason: `Price moved ${priceChange24h.toFixed(2)}% (≥ ${threshold}%) and balance $${balance.toFixed(4)} is sufficient` };
}

// ─── shouldGenerateBias ──────────────────────────────────────────────────────

/**
 * Bias is the core deliverable — always generate it if budget allows.
 * The bar is lower than news/sentiment: no price-movement gate.
 * @param balance Current USDC wallet balance
 */
export function shouldGenerateBias(balance: number): Decision {
  const funded = hasBudget(balance);

  if (!funded) {
    return { should: false, reason: `Insufficient balance: $${balance.toFixed(4)} — need at least $${(MINIMUM_FLOOR + CALL_COST).toFixed(2)}` };
  }
  return { should: true, reason: `Balance $${balance.toFixed(4)} is sufficient to generate bias` };
}

// ─── shouldDeliver ────────────────────────────────────────────────────────────

/**
 * Deliver the brief via Telegram or email. Both cost the same ($0.01).
 * @param balance        Current USDC wallet balance
 * @param deliveryMethod "telegram" | "email"
 */
export function shouldDeliver(
  balance: number,
  deliveryMethod: "telegram" | "email"
): Decision {
  const funded = hasBudget(balance);

  if (!funded) {
    return { should: false, reason: `Insufficient balance: $${balance.toFixed(4)} — cannot deliver via ${deliveryMethod}` };
  }
  return { should: true, reason: `Balance $${balance.toFixed(4)} is sufficient to deliver via ${deliveryMethod}` };
}
