/**
 * StellarBrief x402 data server (correct implementation)
 *
 * Uses @x402/express + @x402/stellar/exact/server.
 * Protects GET /market/:pair behind a $0.01 USDC payment on Stellar testnet.
 * The x402.org facilitator handles verification and on-chain settlement.
 *
 * Returns mock OHLCV data for now — replaced with real data in Day 2.
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

dotenv.config();

const PORT = process.env.DATA_SERVER_PORT ? parseInt(process.env.DATA_SERVER_PORT) : 3001;

// The Stellar testnet address where USDC payments land.
// Must exist on testnet and have a USDC trustline.
const SERVER_WALLET_ADDRESS =
  process.env.SERVER_WALLET_ADDRESS ?? "GA4D33Z3EOB6BU4DOXS2JMZK3JQRABN3ERMF3FK5JF5YPG3CEKRI7WM4";

// ─── Mock OHLCV data ─────────────────────────────────────────────────────────

const BASE_PRICES: Record<string, number> = {
  "BTC-USD": 84000,
  "ETH-USD": 3200,
  "SOL-USD": 140,
  "XLM-USD": 0.11,
  "ADA-USD": 0.45,
};

function mockOhlcv(pair: string) {
  const base = BASE_PRICES[pair.toUpperCase()] ?? 100;
  const jitter = () => base * (1 + (Math.random() - 0.5) * 0.04);
  const open = jitter();
  const close = jitter();
  const high = Math.max(open, close) * (1 + Math.random() * 0.02);
  const low = Math.min(open, close) * (1 - Math.random() * 0.02);
  return {
    pair: pair.toUpperCase(),
    open: parseFloat(open.toFixed(4)),
    high: parseFloat(high.toFixed(4)),
    low: parseFloat(low.toFixed(4)),
    close: parseFloat(close.toFixed(4)),
    volume: parseFloat((Math.random() * 1e6).toFixed(2)),
    timestamp: Date.now(),
    source: "mock (Day 1)",
  };
}

// ─── x402 setup ──────────────────────────────────────────────────────────────

const facilitatorClient = new HTTPFacilitatorClient({
  url: "https://www.x402.org/facilitator",
});

const resourceServer = new x402ResourceServer(facilitatorClient).register(
  "stellar:testnet",
  new ExactStellarScheme()
);

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "StellarBrief data server",
    network: "stellar:testnet",
    payTo: SERVER_WALLET_ADDRESS,
    price: "$0.01 USDC per call",
  });
});

// Protected market data endpoint
app.use(
  paymentMiddleware(
    {
      "GET /market/*": {
        accepts: {
          scheme: "exact",
          payTo: SERVER_WALLET_ADDRESS,
          price: "$0.01",
          network: "stellar:testnet",
        },
        description: "StellarBrief OHLCV market data — $0.01 USDC",
      },
    },
    resourceServer
  )
);

app.get("/market/:pair", (req, res) => {
  const pair = req.params["pair"] ?? "BTC-USD";
  const data = mockOhlcv(pair);
  res.json(data);
});

app.listen(PORT, () => {
  console.log(`[dataServer] Running on http://localhost:${PORT}`);
  console.log(`[dataServer] payTo:   ${SERVER_WALLET_ADDRESS}`);
  console.log(`[dataServer] price:   $0.01 USDC per call`);
  console.log(`[dataServer] network: stellar:testnet`);
  console.log(`[dataServer] facilitator: https://www.x402.org/facilitator`);
});

export { app };
