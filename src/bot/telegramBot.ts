/**
 * StellarBrief Telegram bot — demand side trigger.
 *
 * Commands:
 *   /brief <PAIR1> <PAIR2> ... <threshold>
 *   /balance
 *   /status
 *   /help
 */

import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { checkWalletBalance } from "../tools/checkWalletBalance";
import { runAgent, RunResult } from "../agent/agent";

dotenv.config({ override: true });

// ─── Module-level state ───────────────────────────────────────────────────────

let lastRun: (RunResult & { timestamp: number; watchlist: string[] }) | null = null;
let briefInProgress = false;

// ─── Parse /brief command ─────────────────────────────────────────────────────

interface BriefCommand {
  watchlist: string[];
  threshold: number;
}

interface ParseError {
  error: string;
}

function parseBriefCommand(text: string): BriefCommand | ParseError {
  const parts = text.trim().split(/\s+/);
  // Minimum: /brief PAIR threshold  → 3 tokens
  if (parts.length < 3) {
    return { error: "Too few arguments. Provide at least one pair and a threshold.\nExample: `/brief BTC-USD ETH-USD 2.0`" };
  }

  const lastToken = parts[parts.length - 1];
  const threshold = parseFloat(lastToken);
  if (isNaN(threshold)) {
    return { error: `The last argument must be a number (threshold). Got: *${lastToken}*\nExample: \`/brief BTC-USD 2.0\`` };
  }
  if (threshold < 0.1 || threshold > 20) {
    return { error: `Threshold must be between 0.1 and 20. Got: *${threshold}*\nTip: 2.0 means "only fetch news/sentiment if 24h price move ≥ 2%"` };
  }

  const watchlist = parts
    .slice(1, -1)
    .map((p) => p.toUpperCase())
    .filter((p) => /^[A-Z0-9]+-[A-Z0-9]+$/.test(p));

  if (watchlist.length === 0) {
    return { error: "No valid pairs found. Pairs must be in COIN-USD format.\nExample: `BTC-USD`, `ETH-USD`, `SOL-USD`" };
  }

  return { watchlist, threshold };
}

function isParseError(r: BriefCommand | ParseError): r is ParseError {
  return "error" in r;
}

// ─── Bot setup ────────────────────────────────────────────────────────────────

export function startBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[bot] TELEGRAM_BOT_TOKEN is not set — bot cannot start.");
    process.exit(1);
  }

  const bot = new TelegramBot(token, { polling: true });
  console.log("[bot] Polling started. Waiting for commands...");

  // ── /help ──────────────────────────────────────────────────────────────────

  bot.onText(/^\/help/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
      chatId,
      `*StellarBrief* — an autonomous trading intelligence agent powered by Claude and Stellar micropayments.
It analyzes crypto pairs, generates directional bias signals, and delivers briefs to your Telegram — paying for every data call in real USDC via x402 on Stellar.

*Commands:*

/brief <PAIR1> <PAIR2> ... <threshold>
  Run a full analysis. Fetches live prices, news, and Claude-generated bias for each pair.
  Example: \`/brief BTC-USD ETH-USD SOL-USD 2.0\`
  Pairs: any top-20 coin vs USD (BTC, ETH, SOL, XLM, ADA, XRP, AVAX, LINK, etc.)
  Threshold: minimum 24h % move to trigger news + sentiment (0.1–20).

/balance
  Check the agent wallet's current USDC balance on Stellar Testnet.

/status
  Show a summary of the last brief run: pairs analyzed, USDC spent, delivery status, and time.

/help
  Show this message.

*How pricing works:*
Each API call (market data, news, sentiment, bias, delivery) costs *$0.01 USDC* from the agent wallet, paid automatically via x402 micropayments on Stellar Testnet.

*Supply side:*
The data API runs on \`http://localhost:3001\` and is open to any x402-compatible client. Any tool that can pay $0.01 USDC per request can call \`/market/:pair\`, \`/news/:pair\`, \`/sentiment/:pair\`, \`/bias/:pair\`, \`/deliver/email\`, or \`/deliver/telegram\` directly — no API key required.`,
      { parse_mode: "Markdown" }
    );
  });

  // ── /balance ───────────────────────────────────────────────────────────────

  bot.onText(/^\/balance/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const balance = await checkWalletBalance();
      await bot.sendMessage(
        chatId,
        `💰 *Agent Wallet Balance*\n$${balance.toFixed(2)} USDC\nStellar Testnet`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      await bot.sendMessage(
        chatId,
        `❌ Error checking balance: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });

  // ── /status ────────────────────────────────────────────────────────────────

  bot.onText(/^\/status/, (msg) => {
    const chatId = msg.chat.id;

    if (briefInProgress) {
      bot.sendMessage(chatId, "⏳ *Brief in progress* — the agent is currently fetching data and analyzing pairs. Use /status again when it's done.");
      return;
    }

    if (!lastRun) {
      bot.sendMessage(chatId, "No brief has been run yet. Use /brief to get started.");
      return;
    }

    const { pairs, spendLog, delivered, partial, totalSpent, timestamp, watchlist } = lastRun;
    const completedPairs = pairs.filter((p) => p.bias);
    const date = new Date(timestamp).toISOString().replace("T", " ").slice(0, 19) + " UTC";

    // Determine why it was partial (wallet low vs. data/server error)
    let partialNote = "No";
    if (partial && totalSpent === 0) {
      partialNote = "⚠️ Yes — no data fetched (server unreachable or unsupported pair)";
    } else if (partial) {
      partialNote = "⚠️ Yes — wallet ran low mid-run";
    }

    const lines = [
      `📊 *Last Brief Summary*`,
      ``,
      `Pairs requested:  ${watchlist.join(", ")}`,
      `Pairs completed:  ${completedPairs.length} / ${watchlist.length}`,
      `Total spent:      $${totalSpent.toFixed(4)} USDC (${spendLog.length} calls)`,
      `Delivered:        ${delivered ? "✅ Yes" : "❌ No"}`,
      `Partial run:      ${partialNote}`,
      `Run time:         ${date}`,
    ];

    bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
  });

  // ── /brief ─────────────────────────────────────────────────────────────────

  bot.onText(/^\/brief(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const rawText = `/brief${match?.[1] ?? ""}`;

    const parsed = parseBriefCommand(rawText);

    if (isParseError(parsed)) {
      await bot.sendMessage(chatId, `❌ ${parsed.error}`, { parse_mode: "Markdown" });
      return;
    }

    const { watchlist, threshold } = parsed;

    // Block concurrent runs
    if (briefInProgress) {
      await bot.sendMessage(chatId, "⏳ A brief is already running. Please wait for it to finish before starting another.");
      return;
    }

    // Send acknowledgement immediately — do not block on agent run
    briefInProgress = true;
    await bot.sendMessage(
      chatId,
      `⏳ *Running StellarBrief...*\nAnalyzing ${watchlist.length} pair${watchlist.length > 1 ? "s" : ""} with ${threshold}% threshold.\nChecking wallet and fetching live data now.`,
      { parse_mode: "Markdown" }
    );

    console.log(`[bot] /brief from chat ${chatId}: pairs=[${watchlist.join(",")}] threshold=${threshold}`);

    // Run agent asynchronously — deliver_brief tool sends the brief directly to this chat
    runAgent(watchlist, threshold, "telegram", chatId.toString())
      .then(async (result) => {
        briefInProgress = false;
        lastRun = { ...result, timestamp: Date.now(), watchlist };

        console.log(`[bot] Run complete — spent $${result.totalSpent.toFixed(4)}, delivered=${result.delivered}, partial=${result.partial}`);

        // Agent's deliver_brief already sent the message to this chat if successful.
        // Only send fallback if delivery did not happen.
        if (!result.delivered) {
          const pairsWithBias = result.pairs.filter((p) => p.bias);

          // Diagnose why it failed — "wallet low" is misleading when nothing was spent
          let headline: string;
          if (result.totalSpent === 0) {
            headline = `⚠️ *Brief failed — no data was fetched.*\nThe data server may be unreachable, or one of the pairs is not supported. Supported bases: BTC, ETH, SOL, XLM, ADA, XRP, BNB, DOGE, AVAX, LINK and other top-20 crypto coins.`;
          } else if (result.partial) {
            headline = `⚠️ *Partial brief* — wallet ran low before all pairs were complete.`;
          } else {
            headline = `⚠️ *Brief complete but delivery failed.*`;
          }

          const lines: string[] = [
            headline,
            `Completed: ${pairsWithBias.length}/${watchlist.length} pairs`,
          ];

          for (const p of pairsWithBias) {
            const b = p.bias as {
              signal?: string;
              confidence?: string;
              rationale?: string;
              keyLevels?: { support?: number; resistance?: number };
            } | undefined;
            const m = p.marketData as { change24h?: number } | undefined;
            if (b) {
              lines.push(
                `\n*${p.pair}*\nSignal: ${b.signal ?? "—"}  Confidence: ${b.confidence ?? "—"}\n24h: ${m?.change24h?.toFixed(2) ?? "?"}%\nSupport: $${b.keyLevels?.support ?? "—"}  Resistance: $${b.keyLevels?.resistance ?? "—"}\n${b.rationale ?? ""}`
              );
            }
          }

          lines.push(`\n─── Wallet Summary ───`);
          lines.push(`Spent: $${result.totalSpent.toFixed(4)} USDC across ${result.spendLog.length} calls`);

          await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
        }
      })
      .catch(async (err) => {
        briefInProgress = false;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[bot] Agent error: ${message}`);
        await bot.sendMessage(chatId, `❌ Agent error: ${message}`);
      });
  });

  // ── Polling error handler ──────────────────────────────────────────────────

  bot.on("polling_error", (err) => {
    console.error("[bot] Polling error:", err.message);
  });
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

if (require.main === module) {
  startBot();
}
