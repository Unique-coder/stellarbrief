/**
 * StellarBrief — Architecture & Flow Diagram
 *
 * Three segments of work completed, from scaffold to confirmed on-chain payment.
 * Run directly to print the flow:  ts-node src/utils/chart.ts
 */

// ─────────────────────────────────────────────────────────────────────────────
//  SEGMENT 1  —  Project Scaffold & Wallet Setup
// ─────────────────────────────────────────────────────────────────────────────
export const SEGMENT_1_FLOW = `
╔══════════════════════════════════════════════════════════════════╗
║              SEGMENT 1 — Project Scaffold & Wallet               ║
╚══════════════════════════════════════════════════════════════════╝

  npm init  ──►  TypeScript + ts-node  ──►  .nvmrc (Node 20)
        │
        ▼
  @stellar/stellar-sdk v15
  @anthropic-ai/sdk
  dotenv + express + cors
        │
        ▼
  ┌───────────────────────────────┐
  │  src/tools/generateKeypair.ts │  ← Keypair.random() → public + secret
  └───────────────────────────────┘
        │  secret key → .env  STELLAR_SECRET_KEY=S...
        ▼
  ┌─────────────────────────────────────┐
  │  src/tools/setupUsdcTrustline.ts    │  ← ChangeTrust op, signed + submitted
  └─────────────────────────────────────┘
        │  trustline created on testnet
        ▼
  ┌──────────────────────────────────┐
  │  src/tools/checkWalletBalance.ts │  ← Horizon API → USDC balance
  └──────────────────────────────────┘
        │
        ▼
  ✓ Agent wallet:  GATK7N...BYJPM
  ✓ Server wallet: GA4D33...I7WM4
  ✓ USDC balance confirmed: $20.00 (client) / $41.20 (server)
`;

// ─────────────────────────────────────────────────────────────────────────────
//  SEGMENT 2  —  x402 Integration Attempt (Wrong Path → Corrected)
// ─────────────────────────────────────────────────────────────────────────────
export const SEGMENT_2_FLOW = `
╔══════════════════════════════════════════════════════════════════╗
║        SEGMENT 2 — x402 Integration (EVM path — incorrect)       ║
╚══════════════════════════════════════════════════════════════════╝

  xlm402.com/pairs/BTC-USD
        │
        ▼  HTTP 402
  hand-crafted EVM-style x402 flow (WRONG)
        │
        ├─ Signed full raw Stellar transaction XDR
        ├─ Sent to x402.org/facilitator
        └─ Error: "unexpected_verify_error"  ✗

  Also: xlm402.com returned 500 on all endpoints (server outage)  ✗

  ══════════════════════════════
  CORRECTIONS IDENTIFIED:
  ══════════════════════════════
  ✗  Wrong packages:  x402, x402-stellar, x402-stellar-fetch, x402-stellar-express
  ✗  Wrong signing:   raw tx XDR (EVM pattern)
  ✗  Wrong network:   "stellar-testnet" (dash) → must be "stellar:testnet" (colon)
  ✗  Wrong scheme:    None of the Soroban auth-entry primitives were used

  → Segment 3 rebuilds everything from scratch with correct packages
`;

// ─────────────────────────────────────────────────────────────────────────────
//  SEGMENT 3  —  Correct x402 / Stellar Implementation (End-to-End)
// ─────────────────────────────────────────────────────────────────────────────
export const SEGMENT_3_FLOW = `
╔══════════════════════════════════════════════════════════════════╗
║        SEGMENT 3 — Correct x402 Stellar Flow (Confirmed ✓)       ║
╚══════════════════════════════════════════════════════════════════╝

  Packages installed:
    @x402/core  @x402/express  @x402/fetch  @x402/stellar  v2.9.0

  tsconfig.json paths → CJS .d.ts files (moduleResolution workaround)

  ┌─────────────────────────── SERVER (dataServer.ts) ──────────────────────────┐
  │                                                                              │
  │  ExactStellarScheme()              ← @x402/stellar/exact/server             │
  │  HTTPFacilitatorClient({ url })    ← @x402/core/server                      │
  │  x402ResourceServer                                                          │
  │    .register("stellar:testnet", scheme)                                      │
  │                                                                              │
  │  paymentMiddleware({                                                          │
  │    "GET /market/*": {                                                        │
  │      accepts: {                                                              │
  │        scheme: "exact",                                                      │
  │        payTo: SERVER_WALLET_ADDRESS,   ← GA4D33...                          │
  │        price: "$0.01",                                                       │
  │        network: "stellar:testnet",                                           │
  │      }                                                                       │
  │    }                                                                         │
  │  }, resourceServer)                                                          │
  │                                                                              │
  │  GET /market/:pair  →  mockOhlcv(pair)   (Day 1 placeholder)                │
  └──────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────── CLIENT (fetchMarketData.ts) ─────────────────────┐
  │                                                                              │
  │  createEd25519Signer(secretKey, "stellar:testnet")  ← SEP-43 signer        │
  │  ExactStellarScheme(signer)                          ← Soroban auth signing │
  │  wrapFetchWithPaymentFromConfig(fetch, { schemes })                          │
  │                                                                              │
  └──────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────── END-TO-END PAYMENT FLOW ────────────────────────────────┐
  │                                                                              │
  │  CLIENT                    SERVER                   x402.org/facilitator    │
  │    │                          │                              │               │
  │    │──── GET /market/BTC-USD ►│                              │               │
  │    │                          │                              │               │
  │    │◄─── HTTP 402 ────────────│                              │               │
  │    │     PAYMENT-REQUIRED     │                              │               │
  │    │     header (base64 JSON) │                              │               │
  │    │     {                    │                              │               │
  │    │       x402Version: 2,    │                              │               │
  │    │       amount: "100000",  │  ← 0.01 USDC (6 decimals)   │               │
  │    │       asset: USDC SAC,   │                              │               │
  │    │       payTo: GA4D33...,  │                              │               │
  │    │       areFeesSponsored:  │                              │               │
  │    │         true             │                              │               │
  │    │     }                    │                              │               │
  │    │                          │                              │               │
  │    │  ExactStellarScheme                                      │               │
  │    │  .createPaymentPayload()                                 │               │
  │    │  ─ signs Soroban authorization entry (NOT raw tx)        │               │
  │    │                          │                              │               │
  │    │──── GET /market/BTC-USD ►│                              │               │
  │    │     X-PAYMENT: <payload> │                              │               │
  │    │                          │──── verify(payload) ────────►│               │
  │    │                          │◄─── OK + settle() ───────────│               │
  │    │                          │     (facilitator submits      │               │
  │    │                          │      tx to Stellar testnet)   │               │
  │    │                          │                              │               │
  │    │◄─── HTTP 200 ────────────│                              │               │
  │    │     PAYMENT-RESPONSE     │                              │               │
  │    │     { txHash }           │                              │               │
  │    │     + OHLCV JSON body    │                              │               │
  │    │                          │                              │               │
  │                                                                              │
  │  RESULT (confirmed 2026-04-08):                                              │
  │    Client balance:   $19.99 → $19.97  (paid $0.02 across 2 calls)           │
  │    Server balance:   $41.20 → $41.22                                         │
  │    Tx hash:  5f08e75cba94ea0f03241570b4f7c2599d8cc13e9cca3701b6928a5bd8d8f711 │
  └──────────────────────────────────────────────────────────────────────────────┘
`;

// ─────────────────────────────────────────────────────────────────────────────
//  MERMAID  —  Machine-renderable version (paste at mermaid.live)
// ─────────────────────────────────────────────────────────────────────────────
export const MERMAID_DIAGRAM = `
sequenceDiagram
  participant C as Client<br/>(fetchMarketData.ts)
  participant S as Server<br/>(dataServer.ts)
  participant F as x402.org<br/>Facilitator
  participant L as Stellar<br/>Testnet Ledger

  C->>S: GET /market/BTC-USD
  S-->>C: 402 PAYMENT-REQUIRED<br/>{ scheme:exact, amount:100000, asset:USDC SAC,<br/>payTo:GA4D33..., areFeesSponsored:true }

  Note over C: createEd25519Signer(secretKey, "stellar:testnet")<br/>ExactStellarScheme.createPaymentPayload()<br/>→ signs Soroban authorization entry

  C->>S: GET /market/BTC-USD<br/>X-PAYMENT: { signedAuthEntry, ... }
  S->>F: verify(payload)
  F->>L: submitTransaction(builtTx)
  L-->>F: tx confirmed
  F-->>S: settled { txHash }
  S-->>C: 200 OK<br/>PAYMENT-RESPONSE: { txHash }<br/>Body: { pair, open, high, low, close, volume }
`;

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS THAT NEED MANUAL UPDATE
// ─────────────────────────────────────────────────────────────────────────────
export const UPDATE_CHECKLIST = `
╔══════════════════════════════════════════════════════════════════╗
║          CONSTANTS & VARIABLES REQUIRING MANUAL UPDATE           ║
╚══════════════════════════════════════════════════════════════════╝

  FILE                              VARIABLE / CONSTANT
  ─────────────────────────────────────────────────────────────────

  .env  (not version-controlled)
  ├─ STELLAR_SECRET_KEY             Agent wallet secret — your own testnet key
  ├─ ANTHROPIC_API_KEY              From console.anthropic.com — not public
  ├─ SERVER_WALLET_ADDRESS          Your server's receiving wallet address
  └─ DATA_SERVER_URL                Change to real hostname when deployed

  checkWalletBalance.ts  (line 7)
  └─ USDC_ISSUER_TESTNET            "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
                                    → mainnet: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"

  setupUsdcTrustline.ts  (line 10)
  └─ USDC_ISSUER_TESTNET            Same as above — update both or extract to shared constants

  dataServer.ts  (line 25 & line 58–64)
  ├─ SERVER_WALLET_ADDRESS          Hardcoded fallback GA4D33... — replace with your address
  ├─ BASE_PRICES                    Static mock prices — replace in Day 2 with real market API
  ├─ source: "mock (Day 1)"         Placeholder — update when real data source is wired in
  └─ "https://www.x402.org/facilitator"
                                    Public facilitator — works on testnet
                                    → self-host for mainnet production

  fetchMarketData.ts  (line 59)
  └─ "stellar:testnet"              Hardcoded network — parameterize or use env var for mainnet

  NETWORK-WIDE: when moving to mainnet
  ├─ All "stellar:testnet" → "stellar:pubnet"
  ├─ Horizon URL → https://horizon.stellar.org
  ├─ USDC SAC (inside @x402/stellar) testnet: CBIELTK6...DAMA
  │                                  mainnet: CCW67TSZVV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7EJJUST
  └─ areFeesSponsored may be false on mainnet — account needs XLM for fees
`;

// ─────────────────────────────────────────────────────────────────────────────
//  CLI print
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  console.log(SEGMENT_1_FLOW);
  console.log(SEGMENT_2_FLOW);
  console.log(SEGMENT_3_FLOW);
  console.log("\n── Mermaid (paste at https://mermaid.live) ──");
  console.log(MERMAID_DIAGRAM);
  console.log(UPDATE_CHECKLIST);
}
