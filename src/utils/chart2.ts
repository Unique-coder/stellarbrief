/**
 * StellarBrief — Day 2 Architecture & Flow Diagram
 *
 * Four segments: real data endpoints, decision functions,
 * Claude agent tool loop, and Telegram bot E2E delivery.
 * Run directly to print the flow:  ts-node src/utils/chart2.ts
 */

// ─────────────────────────────────────────────────────────────────────────────
//  SEGMENT 1  —  Real Data Server (6 x402-gated endpoints)
// ─────────────────────────────────────────────────────────────────────────────
export const SEGMENT_1_FLOW = `
╔══════════════════════════════════════════════════════════════════════════════╗
║        SEGMENT 1 — Real Data Server  (dataServer.ts Day 2 rewrite)          ║
╚══════════════════════════════════════════════════════════════════════════════╝

  Day 1 left mock data in all endpoints.
  Day 2 wires every route to a real external source behind a $0.01 USDC gate.

  Packages added:
    anthropic (claude-haiku-4-5 calls)
    resend    (email delivery)

  ┌────────────────────────────────────────────────────────────────┐
  │                  paymentMiddleware (x402)                       │
  │  all six routes below return HTTP 402 without a valid payment   │
  └────────────────────────────────────────────────────────────────┘
         │
         ├─ GET /market/:pair ──────► CoinGecko /coins/markets API
         │                             { price, change24h, high24h, low24h, volume24h }
         │                             NOTE: /simple/price used in Day 1 lacks high/low
         │                             → switched to /coins/markets for full OHLCV
         │
         ├─ GET /news/:pair ───────► CoinDesk RSS  (feedburner.com/CoinDesk)
         │                             Parses <item> blocks, CDATA-aware regex
         │                             Filters by coin name / ticker against title+category
         │                             Falls back to top-5 general items if no match
         │                             NOTE: CryptoPanic rejected with 429 rate-limit
         │                             → switched to CoinDesk RSS (no auth required)
         │
         ├─ GET /sentiment/:pair ──► CoinDesk RSS  →  claude-haiku-4-5
         │                             Prompt: "score from -1.0 to +1.0"
         │                             Returns: { score, label, rationale }
         │
         ├─ GET /bias/:pair ───────► CoinGecko + CoinDesk + claude-haiku-4-5
         │                             Internal pipeline (no extra x402 cost):
         │                               fetchCoinGeckoPrice()
         │                               fetchCoinDeskNews()
         │                               claudeSentiment()   ← internal
         │                               claudeBias()        ← final output
         │                             Returns: { signal, confidence, rationale, keyLevels }
         │
         ├─ POST /deliver/email ───► Resend SDK  (resend.com)
         │                             from: "StellarBrief <brief@stellarbrief.app>"
         │                             Falls back to console.log if RESEND_API_KEY empty
         │
         └─ POST /deliver/telegram ► Telegram Bot API
                                      POST /sendMessage  { chat_id, text, parse_mode }
                                      Falls back to console.log if TELEGRAM_BOT_TOKEN empty

  Critical fix — dotenvx override:
    Shell environment from Claude Code CLI injects ANTHROPIC_API_KEY="" (empty).
    dotenvx by default does NOT override existing env vars.
    Fix: dotenv.config({ override: true })  ← forces .env values to win
    Confirmed: "injected env (9)" → "injected env (10)" after fix

  Wallets (Day 2 baseline):
    Agent  wallet: GATK7N...BYJPM  $19.87 USDC
    Server wallet: GA4D33...I7WM4  $41.37 USDC
`;

// ─────────────────────────────────────────────────────────────────────────────
//  SEGMENT 2  —  Decision Functions & Unit Tests
// ─────────────────────────────────────────────────────────────────────────────
export const SEGMENT_2_FLOW = `
╔══════════════════════════════════════════════════════════════════════════════╗
║        SEGMENT 2 — Decision Functions  (src/agent/decisions/index.ts)       ║
╚══════════════════════════════════════════════════════════════════════════════╝

  Four pure functions — no I/O, deterministic, fully unit-tested.
  These run inside each tool handler in agent.ts as a safety layer.
  Claude's system prompt tells it to follow the same rules; TypeScript enforces them.

  Constants:
    CALL_COST     = 0.01   USDC — cost of one x402 endpoint call
    MINIMUM_FLOOR = 0.05   USDC — wallet must never drop below this

  Budget gate (shared by all functions):
    hasBudget(balance) = balance - CALL_COST >= MINIMUM_FLOOR
    i.e.  balance >= 0.06  to allow any paid action

  ┌──────────────────────────────────────────────────────────────────┐
  │  shouldFetchNews(balance, threshold, priceChange24h)             │
  │    → false if !hasBudget(balance)   reason: "Insufficient..."    │
  │    → false if |priceChange| < threshold  reason: "below threshold"│
  │    → true  otherwise                                             │
  └──────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────┐
  │  shouldFetchSentiment(balance, threshold, priceChange24h)        │
  │    Identical gate logic to shouldFetchNews.                      │
  │    Sentiment without meaningful price movement adds noise.       │
  └──────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────┐
  │  shouldGenerateBias(balance)                                     │
  │    No price-movement gate — bias is the core deliverable.        │
  │    → false if !hasBudget(balance)                                │
  │    → true  otherwise                                             │
  └──────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────┐
  │  shouldDeliver(balance, deliveryMethod)                          │
  │    → false if !hasBudget(balance)                                │
  │    → true  otherwise  (reason includes deliveryMethod name)      │
  └──────────────────────────────────────────────────────────────────┘

  Test suite — src/agent/decisions/decisions.test.ts
    Runner:   node --require ts-node/register --test
    39 tests  across 5 describe blocks
    Covers:   positive/negative price swings
              exact boundary values  (0.06 → true;  0.05 → false)
              zero balance
              reason string content
              cross-cutting constant enforcement
    Result:   39 pass  ✓  0 fail
`;

// ─────────────────────────────────────────────────────────────────────────────
//  SEGMENT 3  —  Claude Agent Tool Loop
// ─────────────────────────────────────────────────────────────────────────────
export const SEGMENT_3_FLOW = `
╔══════════════════════════════════════════════════════════════════════════════╗
║        SEGMENT 3 — Agent Tool Loop  (src/agent/agent.ts)                    ║
╚══════════════════════════════════════════════════════════════════════════════╝

  Model:  claude-sonnet-4-6  (max_tokens: 4096)
  Loop:   while stop_reason === "tool_use"  (cap: 100 iterations)

  Types exported:
    SpendEntry   { tool, cost, balanceBefore, balanceAfter, timestamp }
    PairResult   { pair, marketData?, news?, sentiment?, bias? }
    RunResult    { pairs, spendLog, delivered, partial, totalSpent }

  ┌───────────────── 6 Tool Definitions (Anthropic.Tool[]) ──────────────────┐
  │                                                                           │
  │  check_wallet_balance   FREE  — always available, no x402                │
  │  fetch_market_data      $0.01 — CoinGecko OHLCV via x402                 │
  │  fetch_news             $0.01 — CoinDesk RSS via x402 (gated)            │
  │  fetch_sentiment        $0.01 — Claude haiku via x402 (gated)            │
  │  generate_bias          $0.01 — Claude haiku via x402 (always if budget) │
  │  deliver_brief          $0.01 — Telegram or email via x402               │
  │                                                                           │
  └───────────────────────────────────────────────────────────────────────────┘

  System prompt instructs Claude to:
    1. check_wallet_balance before every paid action
    2. fetch_market_data for every pair (if budget)
    3. fetch_news + fetch_sentiment only if |24h change| >= threshold
    4. generate_bias always (core deliverable)
    5. deliver_brief ONCE after all pairs complete
    6. stop and deliver partial brief if balance - 0.01 < 0.05

  Per-pair pipeline (as Claude executes it):
    check_wallet_balance
        │
        ▼
    fetch_market_data(pair)  ──► paidGet("/market/{pair}")
        │
        ├─ if |change24h| >= threshold:
        │     check_wallet_balance
        │     fetch_news(pair)       ──► paidGet("/news/{pair}")
        │     check_wallet_balance
        │     fetch_sentiment(pair)  ──► paidGet("/sentiment/{pair}")
        │
        ▼
    check_wallet_balance
    generate_bias(pair)      ──► paidGet("/bias/{pair}")

  After all pairs:
    check_wallet_balance
    deliver_brief(method, chatId/to, message)  ──► paidPost("/deliver/{method}")

  Defense-in-depth:
    Claude decides via system prompt  →  TypeScript handlers re-check
    same shouldFetchNews / shouldGenerateBias / shouldDeliver logic
    If Claude requests a call the handler would block, returns { skipped, reason }

  x402 helpers (paidGet / paidPost):
    1. checkWalletBalance()           → balanceBefore
    2. fetchWithPayment(url)          → x402 handshake + USDC transfer
    3. checkWalletBalance()           → balanceAfter
    4. spendLog.push(entry)
    5. return JSON

  CLI entrypoint:
    ts-node src/agent/agent.ts BTC-USD,ETH-USD,SOL-USD 2.0 telegram <chatId>
`;

// ─────────────────────────────────────────────────────────────────────────────
//  SEGMENT 4  —  Telegram Bot + E2E Tests
// ─────────────────────────────────────────────────────────────────────────────
export const SEGMENT_4_FLOW = `
╔══════════════════════════════════════════════════════════════════════════════╗
║        SEGMENT 4 — Telegram Bot + E2E Tests  (src/bot/telegramBot.ts)       ║
╚══════════════════════════════════════════════════════════════════════════════╝

  Package:  node-telegram-bot-api  (long-polling mode)

  ┌───────── Commands ──────────────────────────────────────────────────────┐
  │                                                                          │
  │  /help      → usage instructions, cost per call, pair format guide      │
  │                                                                          │
  │  /balance   → checkWalletBalance() → "Agent wallet: $X.XXXX USDC"      │
  │                                                                          │
  │  /brief <PAIR1> <PAIR2> ... <threshold>                                 │
  │    e.g. /brief BTC-USD ETH-USD SOL-USD 2.0                              │
  │    parseBriefCommand():                                                  │
  │      parts[0]    = "/brief"   (ignored)                                  │
  │      parts[1..n-1] = pairs   (validated: /^[A-Z0-9]+-[A-Z0-9]+$/)      │
  │      parts[n]    = threshold  (parseFloat, must be > 0)                 │
  │                                                                          │
  └──────────────────────────────────────────────────────────────────────────┘

  /brief execution flow:
    1. Immediate ACK message → "Running StellarBrief... may take 30-60s"
    2. runAgent(watchlist, threshold, "telegram", chatId.toString())
    3a. If result.delivered === true  → agent already sent via deliver_brief ✓
    3b. If result.delivered === false → bot sends fallback summary:
          Pairs with bias rendered inline (signal, confidence, 24h, levels)
          formatSpendSummary() appended (total spent, partial flag)

  ┌───────── E2E Test Results ─────────────────────────────────────────────┐
  │                                                                          │
  │  Test 1  /balance                                                        │
  │    PASS  Agent wallet: $19.87 USDC                                       │
  │                                                                          │
  │  Test 2  Full brief — BTC-USD, ETH-USD, SOL-USD  threshold: 2%          │
  │    PASS  Pairs: 3   Delivered: true   Partial: false                     │
  │    Spend log (7 entries):                                                │
  │      fetch_market_data  $0.01  $19.76 → $19.75  (BTC)                   │
  │      generate_bias      $0.01  $19.75 → $19.74  (BTC)                   │
  │      fetch_market_data  $0.01  $19.74 → $19.73  (ETH)                   │
  │      generate_bias      $0.01  $19.73 → $19.72  (ETH)                   │
  │      fetch_market_data  $0.01  $19.72 → $19.71  (SOL)                   │
  │      generate_bias      $0.01  $19.71 → $19.70  (SOL)                   │
  │      deliver_brief      $0.01  $19.70 → $19.69  (Telegram ✓)            │
  │    news/sentiment skipped: all 24h changes were below 2% threshold      │
  │                                                                          │
  │  Test 3  Partial run (MINIMUM_FLOOR raised to $19.68 for test)          │
  │    PASS  Pairs: 3   Delivered: false   Partial: true                     │
  │    Spend log (1 entry):                                                  │
  │      fetch_market_data  $0.01  $19.69 → $19.68  (BTC only)              │
  │    All further handlers returned { skipped: true } — budget gate fired   │
  │                                                                          │
  │  Test 4  Wallet audit (MINIMUM_FLOOR restored to $0.05)                 │
  │    PASS  x402 micropayments confirmed on-chain                           │
  │    Agent  wallet: $19.87 → $19.68  spent $0.19  (19 tracked calls)      │
  │    Server wallet: $41.76 → $42.01  gained $0.25 (includes prior runs)   │
  │    Every paid call debited agent, credited server via Stellar testnet ✓  │
  │                                                                          │
  └──────────────────────────────────────────────────────────────────────────┘

  Known issues / Notes:
    • Telegram "chat not found": bot must receive at least one /start message
      before it can send outbound messages to the chat — first-time setup step
    • news + sentiment endpoints not exercised in Test 2 because crypto market
      volatility was below 2% threshold on test day (all pairs < 2% 24h move)
    • MINIMUM_FLOOR patch for Test 3 was reverted immediately after the test
`;

// ─────────────────────────────────────────────────────────────────────────────
//  MERMAID  —  Full Day 2 sequence (paste at mermaid.live)
// ─────────────────────────────────────────────────────────────────────────────
export const MERMAID_DIAGRAM = `
sequenceDiagram
  participant U as User<br/>(Telegram)
  participant B as Bot<br/>(telegramBot.ts)
  participant A as Agent<br/>(agent.ts / Claude Sonnet 4.6)
  participant D as Data Server<br/>(dataServer.ts)
  participant X as x402.org<br/>Facilitator
  participant E as External APIs<br/>(CoinGecko / CoinDesk / Claude)

  U->>B: /brief BTC-USD ETH-USD SOL-USD 2.0
  B->>U: ⚙️ Running StellarBrief... (ACK)
  B->>A: runAgent(watchlist, threshold, "telegram", chatId)

  loop For each pair
    A->>A: check_wallet_balance (free)
    A->>D: fetch_market_data(pair)
    D-->>A: HTTP 402
    A->>X: Soroban auth-entry signed payload
    X->>D: verify + settle (USDC transfer on Stellar)
    D->>E: GET coingecko.com/api/v3/coins/markets
    E-->>D: { price, change24h, high24h, low24h, volume24h }
    D-->>A: HTTP 200 market JSON

    Note over A: if |change24h| >= threshold
    A->>D: fetch_news(pair)       [x402 gated]
    D->>E: GET feedburner.com/CoinDesk (RSS)
    E-->>D: XML headlines
    D-->>A: { items: [...] }

    A->>D: fetch_sentiment(pair)  [x402 gated]
    D->>E: claude-haiku-4-5 messages.create
    E-->>D: { score, label, rationale }
    D-->>A: sentiment JSON

    A->>D: generate_bias(pair)    [x402 gated, always]
    D->>E: CoinGecko + CoinDesk + claude-haiku-4-5
    E-->>D: { signal, confidence, rationale, keyLevels }
    D-->>A: bias JSON
  end

  A->>D: deliver_brief(telegram, chatId, message) [x402 gated]
  D->>E: POST api.telegram.org/sendMessage
  E-->>D: 200 OK
  D-->>A: { delivered: true }
  A-->>B: RunResult { delivered: true, partial: false, totalSpent: 0.07 }
  B->>U: (brief already delivered by agent via Telegram ✓)
`;

// ─────────────────────────────────────────────────────────────────────────────
//  UPDATE CHECKLIST  —  what needs changing before mainnet / production
// ─────────────────────────────────────────────────────────────────────────────
export const UPDATE_CHECKLIST = `
╔══════════════════════════════════════════════════════════════════════════════╗
║          DAY 2 CONSTANTS & VARIABLES REQUIRING UPDATE FOR PRODUCTION        ║
╚══════════════════════════════════════════════════════════════════════════════╝

  FILE                              VARIABLE / NOTE
  ──────────────────────────────────────────────────────────────────────────

  .env  (never commit)
  ├─ ANTHROPIC_API_KEY              Needs funded account (console.anthropic.com)
  ├─ RESEND_API_KEY                 Domain verification required for prod sender
  ├─ TELEGRAM_BOT_TOKEN             From BotFather — rotate if ever exposed
  ├─ TELEGRAM_CHAT_ID               User must /start the bot before first delivery
  └─ DATA_SERVER_URL                Change to real hostname when deployed

  dataServer.ts
  ├─ model: "claude-haiku-4-5"      Cheapest Claude for sentiment/bias inference
  │                                 → upgrade to claude-sonnet-4-6 for higher quality
  ├─ "https://www.x402.org/facilitator"
  │                                 Public facilitator — fine for testnet
  │                                 → self-host or use dedicated facilitator on mainnet
  ├─ POST /deliver/email            from: "brief@stellarbrief.app" needs DNS/DKIM records
  └─ CoinDesk RSS fallback          Returns general news if no coin-specific match
                                    → add more RSS feeds per coin for better coverage

  agent.ts
  ├─ model: "claude-sonnet-4-6"     Main reasoning model for tool selection
  │                                 → claude-opus-4-6 for production-grade decisions
  ├─ MAX_ITERATIONS = 100           Safety cap — reduce to 30–40 for production
  └─ MINIMUM_FLOOR = 0.05 USDC      Via decisions/index.ts — raise for prod safety margin

  decisions/index.ts
  ├─ CALL_COST     = 0.01           Update if endpoint pricing changes
  └─ MINIMUM_FLOOR = 0.05           Minimum wallet reserve — tune for risk tolerance

  NETWORK-WIDE: testnet → mainnet
  ├─ "stellar:testnet" → "stellar:pubnet"  (all files)
  ├─ Horizon URL → https://horizon.stellar.org
  └─ USDC SAC: testnet CBIELTK6... → mainnet CCW67TSZVV3SSS2HXMBQ5JFGCKJNXKZM7...
`;

// ─────────────────────────────────────────────────────────────────────────────
//  CLI print
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  console.log(SEGMENT_1_FLOW);
  console.log(SEGMENT_2_FLOW);
  console.log(SEGMENT_3_FLOW);
  console.log(SEGMENT_4_FLOW);
  console.log("\n── Mermaid (paste at https://mermaid.live) ──");
  console.log(MERMAID_DIAGRAM);
  console.log(UPDATE_CHECKLIST);
}
