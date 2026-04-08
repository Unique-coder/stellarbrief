/**
 * fetchMarketData — x402 paid tool (correct implementation)
 *
 * Uses the canonical @x402/stellar + @x402/fetch stack:
 *   - createEd25519Signer   : builds a SEP-43 signer from the agent's secret key
 *   - ExactStellarScheme    : signs a Soroban *authorization entry* (not a raw tx)
 *   - wrapFetchWithPaymentFromConfig : auto-handles 402 → sign → retry
 *
 * Payment flow:
 *   1. GET /market/:pair → 402 with PaymentRequired headers
 *   2. ExactStellarScheme.createPaymentPayload() signs the Soroban auth entry
 *   3. Retry with X-PAYMENT header
 *   4. x402.org facilitator verifies + submits on-chain
 *   5. Server returns OHLCV data + X-PAYMENT-RESPONSE header with tx hash
 */

import dotenv from "dotenv";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";

dotenv.config();

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OHLCVData {
  pair: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
  source: string;
}

export interface FetchMarketDataResult {
  data: OHLCVData;
  amountPaidUsdc: number;
  txHash: string | undefined;
  payer: string;
  endpoint: string;
}

// ─── Main tool function ──────────────────────────────────────────────────────

export async function fetchMarketData(
  pair: string,
  endpointBase?: string
): Promise<FetchMarketDataResult> {
  const secretKey = process.env.STELLAR_SECRET_KEY;
  if (!secretKey) throw new Error("STELLAR_SECRET_KEY not set in environment");

  const base = endpointBase ?? process.env.DATA_SERVER_URL ?? "http://localhost:3001";
  const normalizedPair = pair.toUpperCase().replace("/", "-");
  const endpoint = `${base}/market/${normalizedPair}`;

  // Build the correct Stellar x402 signer (SEP-43 Ed25519, signs auth entries)
  const signer = createEd25519Signer(secretKey, "stellar:testnet");

  // Wrap fetch: auto-handles 402 → ExactStellarScheme.createPaymentPayload → retry
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: "stellar:*",
        client: new ExactStellarScheme(signer),
      },
    ],
  });

  console.log(`[fetchMarketData] Requesting ${normalizedPair} from ${endpoint} ...`);

  const response = await fetchWithPayment(endpoint);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed ${response.status}: ${body}`);
  }

  // Decode the payment confirmation header (contains tx hash, amount, payer)
  const paymentResponseStr =
    response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE");
  const paymentInfo = paymentResponseStr ? decodePaymentResponseHeader(paymentResponseStr) : undefined;

  const data = (await response.json()) as OHLCVData;

  const amountPaidUsdc = paymentInfo
    ? Number(paymentInfo.transaction) === 0
      ? 0
      : 0.01
    : 0.01;

  console.log(
    `[fetchMarketData] ✓ ${normalizedPair} received.`,
    paymentInfo?.transaction ? `Tx: ${String(paymentInfo.transaction).slice(0, 16)}...` : "(no tx info)"
  );

  return {
    data,
    amountPaidUsdc: 0.01,
    txHash: paymentInfo?.transaction ? String(paymentInfo.transaction) : undefined,
    payer: signer.address,
    endpoint,
  };
}

// ─── CLI entrypoint ──────────────────────────────────────────────────────────

if (require.main === module) {
  const pair = process.argv[2] || "BTC-USD";
  fetchMarketData(pair)
    .then((result) => {
      console.log("\n=== Market Data Result ===");
      console.log(`Pair:        ${result.data.pair}`);
      console.log(`Open:        $${result.data.open}`);
      console.log(`High:        $${result.data.high}`);
      console.log(`Low:         $${result.data.low}`);
      console.log(`Close:       $${result.data.close}`);
      console.log(`Volume:      ${result.data.volume}`);
      console.log(`Amount Paid: ${result.amountPaidUsdc.toFixed(4)} USDC`);
      console.log(`Tx Hash:     ${result.txHash ?? "pending settlement"}`);
      console.log(`Payer:       ${result.payer.slice(0, 12)}...`);
    })
    .catch((err) => {
      console.error("Error:", err.message);
      process.exit(1);
    });
}
