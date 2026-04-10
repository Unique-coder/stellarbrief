/**
 * StellarBrief Telegram bot — demand side trigger.
 *
 * Commands:
 *   /brief <PAIR1> <PAIR2> ... <threshold>
 *       e.g. /brief BTC-USD ETH-USD SOL-USD 2.5
 *       Runs the agent, pays for data via x402, delivers brief to this chat.
 *
 *   /balance
 *       Returns the current USDC balance of the agent wallet.
 *
 *   /help
 *       Usage instructions.
 */

import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { checkWalletBalance } from "../tools/checkWalletBalance";
import { runAgent } from "../agent/agent";

dotenv.config();

// ─── Parse /brief command ─────────────────────────────────────────────────────

interface BriefCommand {
  watchlist: string[];
  threshold: number;
}

function parseBriefCommand(text: string): BriefCommand | null {
  // "/brief BTC-USD ETH-USD SOL-USD 2.5"
  // parts[0] = "/brief", parts[1..n-1] = pairs, parts[n] = threshold
  const parts = text.trim().split(/\s+/);
  if (parts.length < 3) return null; // need at least: /brief PAIR threshold

  const lastToken = parts[parts.length - 1];
  const threshold = parseFloat(lastToken);
  if (isNaN(threshold) || threshold <= 0) return null;

  const watchlist = parts
    .slice(1, -1)
    .map((p) => p.toUpperCase())
    .filter((p) => /^[A-Z0-9]+-[A-Z0-9]+$/.test(p)); // validate pair format

  if (watchlist.length === 0) return null;
  return { watchlist, threshold };
}

// ─── Format RunResult for a status summary (sent on error / partial) ──────────

function formatSpendSummary(
  spendLog: Array<{ tool: string; cost: number; balanceBefore: number; balanceAfter: number }>,
  totalSpent: number,
  partial: boolean
): string {
  const lines = [
    `\n─── Wallet Summary ───`,
    `Total spent: $${totalSpent.toFixed(4)} USDC across ${spendLog.length} calls`,
    partial ? "⚠️  Partial run — wallet ran out before all pairs were analysed." : "",
  ].filter(Boolean);
  return lines.join("\n");
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
      `*StellarBrief* — trading intelligence powered by x402 micropayments on Stellar.

*Commands:*

/brief <PAIR1> <PAIR2> ... <threshold>
  Run a full trading analysis. Each API call costs \\$0\\.01 USDC from the agent wallet\\.
  Example: \`/brief BTC\\-USD ETH\\-USD SOL\\-USD 2\\.0\`
  Pairs: any top\\-20 coin vs USD \\(BTC, ETH, SOL, XLM, ADA, etc\\.\\)
  Threshold: minimum 24h price move \\(\\%\\) to trigger news \\+ sentiment fetching\\.

/balance
  Check the agent wallet's current USDC balance\\.

/help
  Show this message\\.

*How it works:*
The agent checks your wallet, fetches market data for each pair, conditionally fetches news and sentiment if the price is moving, then generates a directional bias using Claude\\. All data is paid for per\\-call via x402 on Stellar testnet\\.`,
      { parse_mode: "MarkdownV2" }
    );
  });

  // ── /balance ───────────────────────────────────────────────────────────────

  bot.onText(/^\/balance/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const balance = await checkWalletBalance();
      bot.sendMessage(chatId, `💰 Agent wallet balance: *$${balance.toFixed(4)} USDC*`, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      bot.sendMessage(chatId, `❌ Error checking balance: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // ── /brief ─────────────────────────────────────────────────────────────────

  bot.onText(/^\/brief(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const rawText = `/brief${match?.[1] ?? ""}`;

    const parsed = parseBriefCommand(rawText);
    if (!parsed) {
      bot.sendMessage(
        chatId,
        `❌ Invalid format. Usage:\n\`/brief BTC-USD ETH-USD 2.0\`\n\nThe last argument must be the volatility threshold (e.g. 2.0 for 2%).\nPairs must be in COIN-USD format.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const { watchlist, threshold } = parsed;

    // Immediate acknowledgement
    await bot.sendMessage(
      chatId,
      `⚙️ *Running StellarBrief...*\n\nChecking wallet and analyzing:\n${watchlist.map((p) => `• ${p}`).join("\n")}\n\nVolatility threshold: ${threshold}%\nThis may take 30–60 seconds depending on pair count.`,
      { parse_mode: "Markdown" }
    );

    console.log(`[bot] /brief received from chat ${chatId}: pairs=${watchlist.join(",")} threshold=${threshold}`);

    try {
      const result = await runAgent(watchlist, threshold, "telegram", chatId.toString());

      console.log(`[bot] Run complete — spent $${result.totalSpent.toFixed(4)}, delivered=${result.delivered}, partial=${result.partial}`);

      // If agent failed to deliver (e.g. wallet too low for delivery), send a fallback summary
      if (!result.delivered) {
        const pairsWithBias = result.pairs.filter((p) => p.bias);
        const lines: string[] = [
          result.partial
            ? `⚠️ *Partial brief* — wallet ran out before all pairs were complete.`
            : `⚠️ *Brief generated but delivery failed.*`,
          `\nCompleted pairs: ${pairsWithBias.length}/${watchlist.length}`,
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

        lines.push(formatSpendSummary(result.spendLog, result.totalSpent, result.partial));
        await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[bot] Agent error: ${message}`);
      await bot.sendMessage(chatId, `❌ Agent error: ${message}`);
    }
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  bot.on("polling_error", (err) => {
    console.error("[bot] Polling error:", err.message);
  });
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

if (require.main === module) {
  startBot();
}
