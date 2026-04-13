@ -1,227 +0,0 @@
# StellarBrief

**A two-sided x402 trading intelligence market on Stellar — where AI agents autonomously pay for the data they consume.**

Built for **Stellar Hacks: Agents — April 2026**

---

StellarBrief is a complete x402 product on Stellar testnet. The supply side is a live trading intelligence API — six endpoints covering live crypto and forex prices, news headlines, Claude-powered sentiment scores, directional bias signals, and multi-channel delivery — each gated at $0.01 USDC per call with no API key required. The demand side is a Claude Sonnet agent, triggered via Telegram, that autonomously works through a watchlist of trading pairs, decides which data to fetch based on wallet balance and market conditions, pays for every call on-chain in USDC via Soroban auth entries, and delivers a structured trading brief. Neither side trusts the other — every interaction is settled on Stellar testnet in real time.

---

## Supply Side — x402 API Endpoints

The data server runs on port 3001. Every route returns HTTP 402 without a valid x402 payment. With payment, it returns real data.

| Endpoint | Returns | Cost |
|----------|---------|------|
| `GET /market/:pair` | Live price, 24h change, OHLCV from CoinGecko. Forex pairs (GBP, EUR, JPY) via open.er-api.com | $0.01 USDC |
| `GET /news/:pair` | Latest headlines from CoinDesk RSS, filtered by coin | $0.01 USDC |
| `GET /sentiment/:pair` | Claude Haiku sentiment score: -1.0 (bearish) to +1.0 (bullish) | $0.01 USDC |
| `GET /bias/:pair` | Claude Haiku directional signal: BULLISH/BEARISH/NEUTRAL, confidence, support/resistance | $0.01 USDC |
| `POST /deliver/email` | Send brief to an email address via Resend | $0.01 USDC |
| `POST /deliver/telegram` | Send brief to a Telegram chat via Bot API | $0.01 USDC |

**Supported pairs:** BTC, ETH, SOL, XLM, ADA, XRP, BNB, DOGE, DOT, AVAX, LINK, LTC, ATOM, NEAR, XAU (gold), and top-20 crypto + GBP, EUR, JPY forex.

### Raw 402 response (no payment)

```bash
curl -i http://localhost:3001/market/BTC-USD
```

```
HTTP/1.1 402 Payment Required
X-PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6MiwicGF5bWVudFJlcXVpcmVtZW50cyI6...

{}
```

The `X-PAYMENT-REQUIRED` header contains a base64-encoded payment challenge with the scheme (`exact`), price (`100000` — 0.01 USDC at 6 decimals), asset (USDC SAC on Stellar testnet), payTo address, and whether fees are sponsored.

**Any x402-compatible client on Stellar testnet can call these endpoints** — no API key, no account, no rate limit beyond the $0.01 USDC per call enforced on-chain.

---

## Demand Side — The Agent

The agent (`src/agent/agent.ts`) runs a Claude Sonnet 4.6 tool-use loop. It receives a watchlist of trading pairs, a volatility threshold, and a delivery target. It then works autonomously:

1. **Checks wallet balance** (free — reads Stellar Horizon)
2. **Fetches market data** for each pair via x402 (`$0.01`)
3. **Fetches news + sentiment** only if `|24h change| ≥ threshold` and budget allows (`$0.01` each)
4. **Generates bias** for every pair regardless of volatility (`$0.01`)
5. **Delivers the brief** via Telegram or email once all pairs are done (`$0.01`)

A minimum floor of $0.05 USDC is maintained at all times. If the wallet would drop below the floor mid-run, the agent stops, notes which pairs are incomplete, and delivers a partial brief with what it has.

### Telegram Commands

```
/brief BTC-USD ETH-USD SOL-USD 2.0
```
Runs the full agent. Threshold 2.0 means news + sentiment are only fetched if the 24h price move is ≥ 2%. The brief is delivered directly to the chat that sent the command.

```
/balance
```
Returns the current USDC balance of the agent wallet on Stellar Testnet.

```
/status
```
Returns a summary of the last run: pairs analyzed, total USDC spent, delivery status, and timestamp. If a brief is currently running, returns "Brief in progress."

```
/help
```
Full usage guide, command reference, and explanation of the x402 cost model.

### Sample Brief — Day 2 E2E Test (BTC-USD, ETH-USD, SOL-USD)

```
═══ BTC-USD ═══
Signal:     BULLISH
Confidence: MEDIUM
24h Change: +1.23%
Support:    $82,000   Resistance: $86,500
Rationale:  BTC consolidating above key support with steady accumulation.
            On-chain metrics remain constructive despite low volatility.
News:       not fetched (24h move below 2% threshold)
Sentiment:  not fetched

═══ ETH-USD ═══
Signal:     NEUTRAL
Confidence: MEDIUM
24h Change: +1.63%
Support:    $1,550   Resistance: $1,720
Rationale:  ETH trading sideways with mixed signals across timeframes.
            No strong directional catalyst present at current levels.
News:       not fetched (24h move below 2% threshold)
Sentiment:  not fetched

═══ SOL-USD ═══
Signal:     BULLISH
Confidence: LOW
24h Change: +1.94%
Support:    $118   Resistance: $132
Rationale:  SOL showing relative strength vs peers near key support zone.
            Low confidence due to thin volume and proximity to threshold.
News:       not fetched (24h move below 2% threshold)
Sentiment:  not fetched

─── Wallet Summary ───
Total spent: $0.07 USDC across 7 calls
Remaining:   $19.69 USDC
```

**Spend log (7 x402 calls, confirmed on Stellar testnet):**

```
fetch_market_data  $0.01  $19.76 → $19.75  (BTC-USD)
generate_bias      $0.01  $19.75 → $19.74  (BTC-USD)
fetch_market_data  $0.01  $19.74 → $19.73  (ETH-USD)
generate_bias      $0.01  $19.73 → $19.72  (ETH-USD)
fetch_market_data  $0.01  $19.72 → $19.71  (SOL-USD)
generate_bias      $0.01  $19.71 → $19.70  (SOL-USD)
deliver_brief      $0.01  $19.70 → $19.69  (Telegram ✓)
```

---

## How It Works — x402 Payment Flow

The agent hits an endpoint (`GET /market/BTC-USD`), receives a `402 Payment Required` response containing a signed payment challenge: scheme `exact`, price `100000` (0.01 USDC), asset address (USDC SAC on Stellar testnet), and the server's receiving wallet. The agent's `ExactStellarScheme` client signs a Soroban authorization entry — not a raw transaction — using the agent's Ed25519 keypair, and retries the request with the signed payload in the `X-PAYMENT` header. The server's x402 middleware forwards the payload to the `x402.org` facilitator, which builds, submits, and confirms the USDC transfer on Stellar testnet before returning the data.

**Confirmed testnet settlement (Day 1 baseline):**
Transaction hash: `5f08e75cba94ea0f03241570b4f7c2599d8cc13e9cca3701b6928a5bd8d8f711`
View on Stellar Expert: https://stellar.expert/explorer/testnet/tx/5f08e75cba94ea0f03241570b4f7c2599d8cc13e9cca3701b6928a5bd8d8f711

**Wallets (Stellar Testnet):**
- Agent wallet: `GATK7NQOQFI2RXEBD4LKVQ7MZ43BLWIVYVKDLUQLRUV7H7BXDRDBYJPM`
- Server wallet: `GA4D33Z3EOB6BU4DOXS2JMZK3JQRABN3ERMF3FK5JF5YPG3CEKRI7WM4`

---

## Setup

**1. Clone and install**
```bash
git clone <repo>
cd stellarbrief
npm install
```

**2. Configure environment**
```bash
cp .env.example .env
```

Edit `.env` and fill in:
```
STELLAR_SECRET_KEY=      # Your Stellar testnet secret key (S...)
ANTHROPIC_API_KEY=       # From console.anthropic.com
TELEGRAM_BOT_TOKEN=      # From @BotFather on Telegram
TELEGRAM_CHAT_ID=        # Your Telegram user ID (send any message to your bot, then check /getUpdates)
RESEND_API_KEY=          # From resend.com (optional — delivery falls back to console if empty)
```

**3. Fund your Stellar testnet wallet**

Generate a keypair:
```bash
npm run generate-keypair
```

Fund with XLM (needed for transaction fees):
- Stellar Friendbot: https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY

Fund with USDC (needed for x402 payments):
- Circle testnet faucet: https://faucet.circle.com

Set up USDC trustline:
```bash
npm run setup-trustline   # or use the USDC trustline tool in src/tools/
```

Check balance:
```bash
npm run check-balance
```

**4. Set up Telegram bot**

- Open Telegram, find `@BotFather`
- Send `/newbot`, follow prompts, copy the token into `TELEGRAM_BOT_TOKEN`
- Send any message to your new bot, then:
  ```bash
  curl https://api.telegram.org/bot<TOKEN>/getUpdates
  ```
  Copy your `chat.id` into `TELEGRAM_CHAT_ID`

**5. Run**

Start the data server (supply side):
```bash
npm run data-server
```

Start the Telegram bot (demand side) in a second terminal:
```bash
npm run bot
```

Send `/brief BTC-USD ETH-USD SOL-USD 2.0` to your bot.

---

## Architecture

**Supply side** — `src/server/dataServer.ts` is an Express app with `@x402/express` payment middleware wrapping all six routes. Each route calls a real external data source: CoinGecko for crypto OHLCV, open.er-api.com for forex, CoinDesk RSS for news, Claude Haiku for AI inference, Resend for email, and the Telegram Bot API for messaging. Responses are cached in-memory for 30 seconds per pair to prevent rate-limit issues in demos. External fetches are wrapped with 5-second `AbortController` timeouts and specific error handling for CoinGecko 429 rate limits (returns HTTP 503 with `retryAfter: 60`). The x402 facilitator at `x402.org` handles payment verification and on-chain settlement — the server never touches the agent's private key.

**Demand side** — `src/agent/agent.ts` initialises an `@x402/stellar` `ExactStellarScheme` signer from the agent's `STELLAR_SECRET_KEY` and wraps `fetch` with `wrapFetchWithPaymentFromConfig`. It then opens a Claude Sonnet 4.6 tool-use loop with six tools, executing each tool call by calling the supply-side API through the x402-wrapped fetch. Four pure decision functions (`src/agent/decisions/index.ts`, 39 unit tests) enforce budget gates in TypeScript as a defence-in-depth layer below Claude's own reasoning. Results accumulate in a `pairMap` and a `spendLog` that records balance before/after every x402 payment. `src/bot/telegramBot.ts` is the entry point: it polls for Telegram messages, calls `runAgent` asynchronously so the acknowledgment is sent immediately, and handles partial or failed runs with a fallback inline summary.

---

*Built for Stellar Hacks: Agents — April 2026*
