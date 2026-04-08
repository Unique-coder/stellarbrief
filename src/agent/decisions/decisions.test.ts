/**
 * Unit tests for agent decision functions.
 * Uses Node's built-in test runner (node:test).
 * Run: npm test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CALL_COST,
  MINIMUM_FLOOR,
  shouldFetchNews,
  shouldFetchSentiment,
  shouldGenerateBias,
  shouldDeliver,
} from "./index";

// Convenient balance values
const FLOOR_PLUS_COST = MINIMUM_FLOOR + CALL_COST;  // 0.06 — exactly enough
const JUST_ENOUGH    = FLOOR_PLUS_COST;              // 0.06
const ONE_CENT_BELOW = FLOOR_PLUS_COST - 0.001;      // 0.059 — one cent under
const COMFORTABLE    = 1.00;
const EMPTY          = 0.00;

// ─── shouldFetchNews ─────────────────────────────────────────────────────────

describe("shouldFetchNews", () => {
  const THRESHOLD = 2.0; // 2% default threshold

  it("returns true when price is moving and balance is sufficient", () => {
    const d = shouldFetchNews(COMFORTABLE, THRESHOLD, 3.5);
    assert.equal(d.should, true);
    assert.match(d.reason, /sufficient/i);
  });

  it("returns true for negative price change exceeding threshold", () => {
    const d = shouldFetchNews(COMFORTABLE, THRESHOLD, -4.0);
    assert.equal(d.should, true);
  });

  it("returns true at exact threshold boundary (>=)", () => {
    const d = shouldFetchNews(COMFORTABLE, THRESHOLD, THRESHOLD);
    assert.equal(d.should, true);
  });

  it("returns false when price change is below threshold (positive)", () => {
    const d = shouldFetchNews(COMFORTABLE, THRESHOLD, 1.99);
    assert.equal(d.should, false);
    assert.match(d.reason, /below threshold/i);
  });

  it("returns false when price change is below threshold (negative)", () => {
    const d = shouldFetchNews(COMFORTABLE, THRESHOLD, -1.99);
    assert.equal(d.should, false);
    assert.match(d.reason, /below threshold/i);
  });

  it("returns false when price change is zero", () => {
    const d = shouldFetchNews(COMFORTABLE, THRESHOLD, 0);
    assert.equal(d.should, false);
  });

  it("returns false when balance is insufficient (regardless of price move)", () => {
    const d = shouldFetchNews(ONE_CENT_BELOW, THRESHOLD, 10.0);
    assert.equal(d.should, false);
    assert.match(d.reason, /insufficient balance/i);
  });

  it("returns false when balance is zero", () => {
    const d = shouldFetchNews(EMPTY, THRESHOLD, 5.0);
    assert.equal(d.should, false);
  });

  it("returns true at exact minimum sufficient balance", () => {
    const d = shouldFetchNews(JUST_ENOUGH, THRESHOLD, THRESHOLD);
    assert.equal(d.should, true);
  });

  it("returns false when balance is insufficient even if price is not moving", () => {
    const d = shouldFetchNews(ONE_CENT_BELOW, THRESHOLD, 0);
    assert.equal(d.should, false);
    // Reason should cite balance (checked first), not price
    assert.match(d.reason, /insufficient balance/i);
  });
});

// ─── shouldFetchSentiment ────────────────────────────────────────────────────

describe("shouldFetchSentiment", () => {
  const THRESHOLD = 2.0;

  it("returns true when price is moving and balance is sufficient", () => {
    const d = shouldFetchSentiment(COMFORTABLE, THRESHOLD, 5.0);
    assert.equal(d.should, true);
  });

  it("returns true for negative price change exceeding threshold", () => {
    const d = shouldFetchSentiment(COMFORTABLE, THRESHOLD, -2.5);
    assert.equal(d.should, true);
  });

  it("returns true at exact threshold boundary", () => {
    const d = shouldFetchSentiment(COMFORTABLE, THRESHOLD, 2.0);
    assert.equal(d.should, true);
  });

  it("returns false when price change is below threshold", () => {
    const d = shouldFetchSentiment(COMFORTABLE, THRESHOLD, 1.5);
    assert.equal(d.should, false);
    assert.match(d.reason, /below threshold/i);
  });

  it("returns false when price change is exactly zero", () => {
    const d = shouldFetchSentiment(COMFORTABLE, THRESHOLD, 0);
    assert.equal(d.should, false);
  });

  it("returns false when balance is insufficient (regardless of price move)", () => {
    const d = shouldFetchSentiment(ONE_CENT_BELOW, THRESHOLD, 99.0);
    assert.equal(d.should, false);
    assert.match(d.reason, /insufficient balance/i);
  });

  it("returns false when balance is zero", () => {
    const d = shouldFetchSentiment(EMPTY, THRESHOLD, 5.0);
    assert.equal(d.should, false);
  });

  it("returns true at exact minimum sufficient balance", () => {
    const d = shouldFetchSentiment(JUST_ENOUGH, THRESHOLD, THRESHOLD);
    assert.equal(d.should, true);
  });

  it("balance check takes priority over price check in reason message", () => {
    const d = shouldFetchSentiment(ONE_CENT_BELOW, THRESHOLD, 0);
    assert.equal(d.should, false);
    assert.match(d.reason, /insufficient balance/i);
  });
});

// ─── shouldGenerateBias ──────────────────────────────────────────────────────

describe("shouldGenerateBias", () => {
  it("returns true when balance is comfortable", () => {
    const d = shouldGenerateBias(COMFORTABLE);
    assert.equal(d.should, true);
    assert.match(d.reason, /sufficient/i);
  });

  it("returns true at exact minimum sufficient balance", () => {
    const d = shouldGenerateBias(JUST_ENOUGH);
    assert.equal(d.should, true);
  });

  it("returns false when balance is one unit below minimum", () => {
    const d = shouldGenerateBias(ONE_CENT_BELOW);
    assert.equal(d.should, false);
    assert.match(d.reason, /insufficient balance/i);
  });

  it("returns false when balance equals MINIMUM_FLOOR exactly", () => {
    // balance - cost = 0.05 - 0.01 = 0.04 < 0.05 floor
    const d = shouldGenerateBias(MINIMUM_FLOOR);
    assert.equal(d.should, false);
  });

  it("returns false when balance is zero", () => {
    const d = shouldGenerateBias(EMPTY);
    assert.equal(d.should, false);
  });

  it("returns false when balance is less than cost alone", () => {
    const d = shouldGenerateBias(0.005);
    assert.equal(d.should, false);
  });

  it("does not require price movement — no threshold parameter", () => {
    // bias has no price gate; just call it with a low but sufficient balance
    const d = shouldGenerateBias(JUST_ENOUGH);
    assert.equal(d.should, true);
  });
});

// ─── shouldDeliver ────────────────────────────────────────────────────────────

describe("shouldDeliver", () => {
  it("returns true for telegram when balance is sufficient", () => {
    const d = shouldDeliver(COMFORTABLE, "telegram");
    assert.equal(d.should, true);
    assert.match(d.reason, /telegram/i);
  });

  it("returns true for email when balance is sufficient", () => {
    const d = shouldDeliver(COMFORTABLE, "email");
    assert.equal(d.should, true);
    assert.match(d.reason, /email/i);
  });

  it("returns true at exact minimum sufficient balance for telegram", () => {
    const d = shouldDeliver(JUST_ENOUGH, "telegram");
    assert.equal(d.should, true);
  });

  it("returns true at exact minimum sufficient balance for email", () => {
    const d = shouldDeliver(JUST_ENOUGH, "email");
    assert.equal(d.should, true);
  });

  it("returns false for telegram when balance is insufficient", () => {
    const d = shouldDeliver(ONE_CENT_BELOW, "telegram");
    assert.equal(d.should, false);
    assert.match(d.reason, /telegram/i);
  });

  it("returns false for email when balance is insufficient", () => {
    const d = shouldDeliver(ONE_CENT_BELOW, "email");
    assert.equal(d.should, false);
    assert.match(d.reason, /email/i);
  });

  it("returns false when balance is zero for telegram", () => {
    const d = shouldDeliver(EMPTY, "telegram");
    assert.equal(d.should, false);
  });

  it("returns false when balance is zero for email", () => {
    const d = shouldDeliver(EMPTY, "email");
    assert.equal(d.should, false);
  });

  it("both methods cost the same — same balance produces same should value", () => {
    const telegram = shouldDeliver(ONE_CENT_BELOW, "telegram");
    const email    = shouldDeliver(ONE_CENT_BELOW, "email");
    assert.equal(telegram.should, email.should);
  });
});

// ─── Cross-cutting: floor arithmetic ─────────────────────────────────────────

describe("MINIMUM_FLOOR constant enforcement", () => {
  it("CALL_COST is 0.01", () => {
    assert.equal(CALL_COST, 0.01);
  });

  it("MINIMUM_FLOOR is 0.05", () => {
    assert.equal(MINIMUM_FLOOR, 0.05);
  });

  it("balance exactly equal to MINIMUM_FLOOR is never sufficient (0.05 - 0.01 = 0.04 < 0.05)", () => {
    assert.equal(shouldGenerateBias(MINIMUM_FLOOR).should, false);
    assert.equal(shouldDeliver(MINIMUM_FLOOR, "telegram").should, false);
  });

  it("balance of FLOOR + COST is always sufficient (0.06 - 0.01 = 0.05 >= 0.05)", () => {
    assert.equal(shouldGenerateBias(FLOOR_PLUS_COST).should, true);
    assert.equal(shouldDeliver(FLOOR_PLUS_COST, "email").should, true);
  });
});
