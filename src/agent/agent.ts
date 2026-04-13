/**
 * StellarBrief agent — demand side brain.
 *
 * Six tools exposed to Claude via the Anthropic SDK tool-use loop:
 *   check_wallet_balance  — free, always available
 *   fetch_market_data     — $0.01 USDC via x402
 *   fetch_news            — $0.01 USDC via x402  (gated: shouldFetchNews)
 *   fetch_sentiment       — $0.01 USDC via x402  (gated: shouldFetchSentiment)
 *   generate_bias         — $0.01 USDC via x402  (gated: shouldGenerateBias)
 *   deliver_brief         — $0.01 USDC via x402  (gated: shouldDeliver)
 *
 * The loop runs until Claude emits stop_reason === "end_turn".
 */

import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { checkWalletBalance } from "../tools/checkWalletBalance";
import {
  shouldFetchNews,
  shouldFetchSentiment,
  shouldGenerateBias,
  shouldDeliver,
  CALL_COST,
} from "./decisions/index";

dotenv.config({ override: true });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpendEntry {
  tool: string;
  cost: number;
  balanceBefore: number;
  balanceAfter: number;
  timestamp: number;
}

export interface PairResult {
  pair: string;
  marketData?: Record<string, unknown>;
  news?: unknown[];
  sentiment?: Record<string, unknown>;
  bias?: Record<string, unknown>;
}

export interface RunResult {
  pairs: PairResult[];
  spendLog: SpendEntry[];
  delivered: boolean;
  partial: boolean;
  totalSpent: number;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a trading intelligence agent with a Stellar USDC wallet.
Your wallet funds are real — every API call you make costs $0.01 USDC.

RULES:
- Check your balance using check_wallet_balance before every paid action.
- For each pair in the watchlist, work through this sequence:
  1. check_wallet_balance
  2. fetch_market_data (always, if budget allows)
  3. check_wallet_balance, then fetch_news if budget allows
  4. check_wallet_balance, then fetch_sentiment if budget allows
  5. check_wallet_balance, then generate_bias ALWAYS if budget allows (this is the core deliverable)
- When all pairs are done, check_wallet_balance, then call deliver_brief ONCE with the full formatted message.
- If your balance drops too low mid-run (balance - 0.01 < 0.05), stop analyzing, note which pairs are incomplete, and deliver a partial brief with what you have.

FORMAT for the deliver_brief message — clean text, one section per pair:
═══ {PAIR} ═══
Signal:     {BULLISH|BEARISH|NEUTRAL}
Confidence: {HIGH|MEDIUM|LOW}
24h Change: {value}%
Support:    ${'{'}support{'}'}   Resistance: ${'{'}resistance{'}'}
Rationale:  {rationale}
News:       {headline count or "not fetched"}
Sentiment:  {score} ({label}) or "not fetched"

End the message with:
─── Wallet Summary ───
Total spent: ${'{'}totalSpent{'}'} USDC across {n} calls
Remaining:   ${'{'}finalBalance{'}'} USDC`;

// ─── Tool definitions (Claude SDK schema) ─────────────────────────────────────

const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "check_wallet_balance",
    description: "Check the current USDC balance of the agent wallet. Free — no cost. Call this before every paid action.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "fetch_market_data",
    description: "Fetch real-time price and 24h OHLCV data for a trading pair from CoinGecko. Costs $0.01 USDC.",
    input_schema: {
      type: "object" as const,
      properties: {
        pair: {
          type: "string",
          description: 'Trading pair in format "BTC-USD", "ETH-USD", "SOL-USD", etc.',
        },
      },
      required: ["pair"],
    },
  },
  {
    name: "fetch_news",
    description:
      "Fetch the latest crypto news headlines for a trading pair from CoinDesk RSS. Costs $0.01 USDC. Call this if budget allows.",
    input_schema: {
      type: "object" as const,
      properties: {
        pair: {
          type: "string",
          description: 'Trading pair e.g. "BTC-USD"',
        },
      },
      required: ["pair"],
    },
  },
  {
    name: "fetch_sentiment",
    description:
      "Fetch Claude-powered sentiment score for a pair based on live headlines. Score: -1.0 (very bearish) to +1.0 (very bullish). Costs $0.01 USDC. Call this if budget allows.",
    input_schema: {
      type: "object" as const,
      properties: {
        pair: {
          type: "string",
          description: 'Trading pair e.g. "ETH-USD"',
        },
      },
      required: ["pair"],
    },
  },
  {
    name: "generate_bias",
    description:
      "Generate a directional bias signal for a pair using Claude. Returns: signal (BULLISH/BEARISH/NEUTRAL), confidence (HIGH/MEDIUM/LOW), rationale, and key support/resistance levels. Costs $0.01 USDC. Always call this if budget allows — it is the core deliverable.",
    input_schema: {
      type: "object" as const,
      properties: {
        pair: {
          type: "string",
          description: 'Trading pair e.g. "SOL-USD"',
        },
      },
      required: ["pair"],
    },
  },
  {
    name: "deliver_brief",
    description:
      "Deliver the completed trading brief to the user. Costs $0.01 USDC. Call this ONCE after all pairs are analyzed with the fully formatted message.",
    input_schema: {
      type: "object" as const,
      properties: {
        method: {
          type: "string",
          enum: ["telegram", "email"],
          description: "Delivery channel",
        },
        chatId: {
          type: "string",
          description: "Telegram chat ID (required when method is telegram)",
        },
        to: {
          type: "string",
          description: "Email address (required when method is email)",
        },
        message: {
          type: "string",
          description: "The fully formatted trading brief to deliver",
        },
      },
      required: ["method", "message"],
    },
  },
];

// ─── runAgent ────────────────────────────────────────────────────────────────

export async function runAgent(
  watchlist: string[],
  volatilityThreshold: number,
  deliveryMethod: "telegram" | "email",
  deliveryTarget: string
): Promise<RunResult> {
  // ── State (closures) ──
  const spendLog: SpendEntry[] = [];
  const pairMap = new Map<string, PairResult>(
    watchlist.map((p) => [p.toUpperCase(), { pair: p.toUpperCase() }])
  );
  let delivered = false;

  // ── x402 client ──
  const secretKey = process.env.STELLAR_SECRET_KEY;
  if (!secretKey) throw new Error("STELLAR_SECRET_KEY not set");

  const signer = createEd25519Signer(secretKey, "stellar:testnet");
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: "stellar:*", client: new ExactStellarScheme(signer) }],
  });

  const DATA_SERVER_URL = process.env.DATA_SERVER_URL ?? "http://localhost:3001";

  // ── Paid call helpers ──

  async function paidGet(path: string, toolName: string): Promise<unknown> {
    const balanceBefore = await checkWalletBalance();
    const response = await fetchWithPayment(`${DATA_SERVER_URL}${path}`);
    if (!response.ok) {
      throw new Error(`${response.status}: ${await response.text()}`);
    }
    const data = await response.json();
    const balanceAfter = await checkWalletBalance();
    spendLog.push({ tool: toolName, cost: CALL_COST, balanceBefore, balanceAfter, timestamp: Date.now() });
    return data;
  }

  async function paidPost(
    path: string,
    body: Record<string, unknown>,
    toolName: string
  ): Promise<unknown> {
    const balanceBefore = await checkWalletBalance();
    const response = await fetchWithPayment(`${DATA_SERVER_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`${response.status}: ${await response.text()}`);
    }
    const data = await response.json();
    const balanceAfter = await checkWalletBalance();
    spendLog.push({ tool: toolName, cost: CALL_COST, balanceBefore, balanceAfter, timestamp: Date.now() });
    return data;
  }

  // ── Tool handler implementations ──

  async function handle_check_wallet_balance(): Promise<unknown> {
    const balance = await checkWalletBalance();
    return { balance, currency: "USDC" };
  }

  async function handle_fetch_market_data(input: { pair: string }): Promise<unknown> {
    const pair = input.pair.toUpperCase();
    const balance = await checkWalletBalance();
    const biasDecision = shouldGenerateBias(balance); // reuse: same budget gate as any paid call
    if (!biasDecision.should) {
      return { skipped: true, reason: biasDecision.reason };
    }
    const data = (await paidGet(`/market/${pair}`, "fetch_market_data")) as Record<string, unknown>;
    // Store for use by downstream decision functions
    const entry = pairMap.get(pair) ?? { pair };
    entry.marketData = data;
    pairMap.set(pair, entry);
    return data;
  }

  async function handle_fetch_news(input: { pair: string }): Promise<unknown> {
    const pair = input.pair.toUpperCase();
    const balance = await checkWalletBalance();
    const storedMarket = pairMap.get(pair)?.marketData as { change24h?: number } | undefined;
    const priceChange = storedMarket?.change24h ?? volatilityThreshold; // if unknown, treat as sufficient
    const decision = shouldFetchNews(balance, volatilityThreshold, priceChange);
    if (!decision.should) {
      return { skipped: true, reason: decision.reason };
    }
    const data = (await paidGet(`/news/${pair}`, "fetch_news")) as Record<string, unknown>;
    const entry = pairMap.get(pair) ?? { pair };
    entry.news = (data as { items?: unknown[] }).items ?? [];
    pairMap.set(pair, entry);
    return data;
  }

  async function handle_fetch_sentiment(input: { pair: string }): Promise<unknown> {
    const pair = input.pair.toUpperCase();
    const balance = await checkWalletBalance();
    const storedMarket = pairMap.get(pair)?.marketData as { change24h?: number } | undefined;
    const priceChange = storedMarket?.change24h ?? volatilityThreshold;
    const decision = shouldFetchSentiment(balance, volatilityThreshold, priceChange);
    if (!decision.should) {
      return { skipped: true, reason: decision.reason };
    }
    const data = (await paidGet(`/sentiment/${pair}`, "fetch_sentiment")) as Record<string, unknown>;
    const entry = pairMap.get(pair) ?? { pair };
    entry.sentiment = data;
    pairMap.set(pair, entry);
    return data;
  }

  async function handle_generate_bias(input: { pair: string }): Promise<unknown> {
    const pair = input.pair.toUpperCase();
    const balance = await checkWalletBalance();
    const decision = shouldGenerateBias(balance);
    if (!decision.should) {
      return { skipped: true, reason: decision.reason };
    }
    const data = (await paidGet(`/bias/${pair}`, "generate_bias")) as Record<string, unknown>;
    const entry = pairMap.get(pair) ?? { pair };
    entry.bias = data;
    pairMap.set(pair, entry);
    return data;
  }

  async function handle_deliver_brief(input: {
    method: string;
    chatId?: string;
    to?: string;
    message: string;
  }): Promise<unknown> {
    const balance = await checkWalletBalance();
    const method = input.method as "telegram" | "email";
    const decision = shouldDeliver(balance, method);
    if (!decision.should) {
      return { skipped: true, reason: decision.reason };
    }

    let result: unknown;
    if (method === "telegram") {
      const chatId = input.chatId ?? deliveryTarget;
      result = await paidPost(
        "/deliver/telegram",
        { chatId, message: input.message },
        "deliver_brief"
      );
    } else {
      const to = input.to ?? deliveryTarget;
      result = await paidPost(
        "/deliver/email",
        { to, subject: "StellarBrief — Trading Intelligence Report", body: input.message },
        "deliver_brief"
      );
    }
    delivered = true;
    return result;
  }

  // ── Tool dispatch map ──

  const handlers: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {
    check_wallet_balance: () => handle_check_wallet_balance(),
    fetch_market_data: (i) => handle_fetch_market_data(i as { pair: string }),
    fetch_news: (i) => handle_fetch_news(i as { pair: string }),
    fetch_sentiment: (i) => handle_fetch_sentiment(i as { pair: string }),
    generate_bias: (i) => handle_generate_bias(i as { pair: string }),
    deliver_brief: (i) =>
      handle_deliver_brief(
        i as { method: string; chatId?: string; to?: string; message: string }
      ),
  };

  // ── Anthropic client ──

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // ── User prompt ──

  const userPrompt = `Analyze the following trading pairs and generate a brief:
Pairs: ${watchlist.join(", ")}
Delivery: ${deliveryMethod} → ${deliveryTarget}

Work through each pair in sequence. Follow the system prompt rules exactly.`;

  // ── Message loop ──

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userPrompt }];

  // Safety cap: prevent runaway loops
  const MAX_ITERATIONS = 100;
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS,
      tool_choice: { type: "auto" },
      messages,
    });

    // Append assistant turn
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") break;
    if (response.stop_reason !== "tool_use") break;

    // Execute every tool_use block in this turn
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      let resultContent: string;
      try {
        const handler = handlers[block.name];
        if (!handler) throw new Error(`Unknown tool: ${block.name}`);
        const result = await handler(block.input as Record<string, unknown>);
        resultContent = JSON.stringify(result);
      } catch (err) {
        resultContent = JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultContent,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  // ── Build RunResult ──

  const pairs = Array.from(pairMap.values());
  const completedPairs = pairs.filter((p) => p.bias !== undefined);
  const partial = completedPairs.length < watchlist.length;
  const totalSpent = spendLog.reduce((sum, e) => sum + e.cost, 0);

  return { pairs, spendLog, delivered, partial, totalSpent };
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

if (require.main === module) {
  const watchlist = (process.argv[2] ?? "BTC-USD,ETH-USD").split(",");
  const threshold = parseFloat(process.argv[3] ?? "2");
  const method = (process.argv[4] ?? "telegram") as "telegram" | "email";
  const target = process.argv[5] ?? process.env.TELEGRAM_CHAT_ID ?? "demo";

  console.log(`[agent] Starting run: ${watchlist.join(", ")} | threshold: ${threshold}% | delivery: ${method} → ${target}`);

  runAgent(watchlist, threshold, method, target)
    .then((result) => {
      console.log("\n=== Run complete ===");
      console.log(`Pairs analyzed:  ${result.pairs.length}`);
      console.log(`Delivered:       ${result.delivered}`);
      console.log(`Partial run:     ${result.partial}`);
      console.log(`Total spent:     $${result.totalSpent.toFixed(4)} USDC`);
      console.log(`\nSpend log (${result.spendLog.length} entries):`);
      result.spendLog.forEach((e) =>
        console.log(`  ${e.tool.padEnd(22)} $${e.cost.toFixed(2)}  balance: $${e.balanceBefore.toFixed(4)} → $${e.balanceAfter.toFixed(4)}`)
      );
    })
    .catch((err) => {
      console.error("Agent error:", err.message);
      process.exit(1);
    });
}
