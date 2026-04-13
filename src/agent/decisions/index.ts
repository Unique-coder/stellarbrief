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
 * Fetch news whenever budget allows.
 * @param balance Current USDC wallet balance
 */
export function shouldFetchNews(
  balance: number,
  _threshold?: number,
  _priceChange24h?: number
): Decision {
  const funded = hasBudget(balance);

  if (!funded) {
    return { should: false, reason: `Insufficient balance: $${balance.toFixed(4)} — need at least $${(MINIMUM_FLOOR + CALL_COST).toFixed(2)}` };
  }
  return { should: true, reason: `Balance $${balance.toFixed(4)} is sufficient to fetch news` };
}

// ─── shouldFetchSentiment ────────────────────────────────────────────────────

/**
 * Fetch sentiment whenever budget allows.
 * @param balance Current USDC wallet balance
 */
export function shouldFetchSentiment(
  balance: number,
  _threshold?: number,
  _priceChange24h?: number
): Decision {
  const funded = hasBudget(balance);

  if (!funded) {
    return { should: false, reason: `Insufficient balance: $${balance.toFixed(4)} — need at least $${(MINIMUM_FLOOR + CALL_COST).toFixed(2)}` };
  }
  return { should: true, reason: `Balance $${balance.toFixed(4)} is sufficient to fetch sentiment` };
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
