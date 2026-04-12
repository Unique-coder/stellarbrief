<!--
=============================================================================
  STELLARBRIEF — DEMO VIDEO SCRIPT
  Hackathon: Stellar Hacks: Agents — April 2026
  Runtime: 3 minutes exactly
  Format: Screen recording + voiceover
=============================================================================

SETUP BEFORE RECORDING
  - Two terminals open side by side
    Left:  data server running  (npm run data-server)
    Right: agent/bot logs       (npm run bot)
  - Telegram open on phone or in a web browser beside the terminals
  - Stellar Expert open in a browser tab:
    https://stellar.expert/explorer/testnet/account/GATK7NQOQFI2RXEBD4LKVQ7MZ43BLWIVYVKDLUQLRUV7H7BXDRDBYJPM
  - Font size bumped to 18pt — make it readable on screen

=============================================================================
  0:00 – 0:20  |  THE PROBLEM
=============================================================================

[SCREEN: blank terminal or title card]

VOICEOVER:
  "AI agents are powerful — but they hit a wall the moment they need to pay
   for data. There's no standard way for an agent to pay per API call.
   You're either hardcoding keys, burning through prepaid budgets blindly,
   or writing custom payment logic for every provider.

   x402 on Stellar solves this. One standard. Any agent. Any data provider.
   Pay per call, on-chain, in USDC — no accounts, no API keys, no trust."

=============================================================================
  0:20 – 0:50  |  THE SUPPLY SIDE — LIVE API
=============================================================================

[SCREEN: left terminal — data server running]

VOICEOVER:
  "Here's the supply side. A live trading intelligence API — six endpoints,
   all behind x402 payment middleware."

[TYPE in terminal:]
  curl -i http://localhost:3001/market/BTC-USD

[SHOW output: HTTP/1.1 402 Payment Required, X-PAYMENT-REQUIRED header]

VOICEOVER:
  "Without payment — 402. The response header contains the payment
   challenge: scheme exact, price $0.01 USDC, Stellar testnet.
   Now watch what happens with a valid x402 client."

[TYPE in terminal — run the fetchMarketData tool or agent CLI for one pair:]
  node -r ts-node/register src/tools/fetchMarketData.ts

[SHOW output: BTC-USD price, 24h change, OHLCV data returned]

VOICEOVER:
  "Data returned. $0.01 USDC paid. Settled on Stellar.
   Anyone's agent can call this endpoint and pay per call —
   no contract, no account, no API key."

=============================================================================
  0:50 – 2:10  |  THE DEMAND SIDE — LIVE AGENT RUN
=============================================================================

[SCREEN: Telegram open]

VOICEOVER:
  "Here's the demand side. A Claude-powered trading agent, triggered
   from Telegram."

[TYPE in Telegram:]
  /balance

[SHOW bot response: 💰 Agent Wallet Balance — $19.xx USDC — Stellar Testnet]

VOICEOVER:
  "The agent has a real USDC wallet on Stellar testnet. Let's put it to work."

[TYPE in Telegram:]
  /brief BTC-USD ETH-USD SOL-USD 2.0

[SHOW immediate ACK: ⏳ Running StellarBrief... Analyzing 3 pairs with 2% threshold...]

VOICEOVER:
  "Acknowledgment fires immediately. The agent is now running autonomously."

[SWITCH to right terminal — bot/agent logs]

[SHOW logs appearing as the agent runs:]
  [agent] Starting run: BTC-USD, ETH-USD, SOL-USD | threshold: 2% | delivery: telegram
  ...tool calls appearing one by one...
  fetch_market_data  $0.01  $19.76 → $19.75
  generate_bias      $0.01  $19.75 → $19.74
  fetch_market_data  $0.01  ...
  ...

VOICEOVER:
  "Watch the tool calls fire in sequence. Market data fetched for each pair.
   Bias signals generated. Each call costs $0.01 USDC — deducted from the
   wallet in real time, settled on Stellar.

   News and sentiment weren't fetched — the agent checked the 24h price
   change first. BTC was only up 1.2%. Below the 2% threshold, so the agent
   skipped those calls. That's budget-aware autonomous reasoning.

   Every paid action ran through the x402 Soroban auth flow — the agent
   signed a payment authorization entry with its Stellar keypair,
   the facilitator verified and submitted the USDC transfer on-chain,
   then the data came back."

[SWITCH back to Telegram]

[SHOW the brief arriving: ═══ BTC-USD ═══ ... Signal: BULLISH ...]

VOICEOVER:
  "The brief arrives. Three pairs analyzed, directional signals, key levels,
   rationale. Wallet summary at the bottom: $0.07 USDC spent across 7 calls.
   Everything paid. Everything settled."

=============================================================================
  2:10 – 2:40  |  ON-CHAIN PROOF — STELLAR EXPLORER
=============================================================================

[SCREEN: Stellar Expert browser tab — agent wallet address]

VOICEOVER:
  "Here's the proof. The agent wallet on Stellar testnet."

[SCROLL through transaction history — show the micropayment transactions]

VOICEOVER:
  "Each row is a real on-chain transaction. $0.01 USDC per call.
   From the agent wallet to the server wallet.
   Every tool call you saw in the logs is here — settled on the ledger."

[CLICK one transaction — show the USDC transfer details]

VOICEOVER:
  "This is a standard USDC asset transfer on Stellar.
   No L2, no off-chain accounting, no trusted intermediary.
   Just the Stellar blockchain settling micropayments in seconds."

[SHOW server wallet — balance has increased by the exact amount spent]

VOICEOVER:
  "And here's the server wallet on the other side.
   It received exactly what the agent spent.
   This is the x402 market clearing."

=============================================================================
  2:40 – 3:00  |  CLOSE
=============================================================================

[SCREEN: split — Telegram brief on left, Stellar explorer on right]

VOICEOVER:
  "Both sides of the x402 market — built and running.

   The supply side is a live API. Any x402-compatible agent can call it,
   pay per call in USDC, and get real trading intelligence.

   The demand side is a live Claude agent. Any user can trigger it from
   Telegram and watch it autonomously consume the API, pay its own bills,
   and deliver a structured brief.

   This is what the internet looks like when machines can pay."

[FADE OUT — show project name: StellarBrief]
[TEXT: Built for Stellar Hacks: Agents — April 2026]

=============================================================================
  BACKUP TALKING POINTS (if demo pauses or loads slowly)
=============================================================================

  - "The x402 protocol is HTTP-native. The server just returns 402 with a
    payment challenge in the header. Any HTTP client can implement the
    response side."

  - "The Soroban auth entry approach means the agent never has to broadcast
    a transaction itself. The facilitator handles that — the agent just
    signs an authorization."

  - "The decision functions in the agent are pure TypeScript — 39 unit tests.
    Claude reasons about budget autonomously, but TypeScript enforces the
    same rules as a defence-in-depth layer."

  - "The server has no idea who the agent is. No login, no session, no
    authentication. The USDC payment is the authentication."

  - "This works for any agent on any stack — the supply side is just HTTP.
    You could call /market/BTC-USD from a Python script, a Go service,
    or another Claude agent entirely."

=============================================================================
-->
