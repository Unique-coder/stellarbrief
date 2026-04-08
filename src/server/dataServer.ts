/**
 * StellarBrief x402 data server — Day 2
 *
 * Six endpoints, all behind $0.01 USDC x402 payment on Stellar testnet.
 * Real data: CoinGecko prices, CryptoPanic RSS news, Claude sentiment + bias.
 * Delivery: Resend email + Telegram bot.
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

dotenv.config();

const PORT = process.env.DATA_SERVER_PORT ? parseInt(process.env.DATA_SERVER_PORT) : 3001;
const SERVER_WALLET_ADDRESS =
  process.env.SERVER_WALLET_ADDRESS ?? "GA4D33Z3EOB6BU4DOXS2JMZK3JQRABN3ERMF3FK5JF5YPG3CEKRI7WM4";

// ─── CoinGecko coin-ID lookup (top 20) ───────────────────────────────────────

const COINGECKO_ID: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XLM: "stellar",
  ADA: "cardano",
  XRP: "ripple",
  BNB: "binancecoin",
  DOGE: "dogecoin",
  DOT: "polkadot",
  MATIC: "matic-network",
  POL: "matic-network",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  UNI: "uniswap",
  LTC: "litecoin",
  ATOM: "cosmos",
  NEAR: "near",
  APT: "aptos",
  SUI: "sui",
  OP: "optimism",
  ARB: "arbitrum",
};

/** Parse "BTC-USD" → { base: "BTC", quote: "USD", geckoId: "bitcoin" } */
function parsePair(raw: string): { base: string; quote: string; geckoId: string } {
  const [base, quote] = raw.toUpperCase().split("-");
  const geckoId = COINGECKO_ID[base];
  if (!geckoId) throw new Error(`Unsupported pair: ${raw}. Supported bases: ${Object.keys(COINGECKO_ID).join(", ")}`);
  return { base, quote: quote ?? "USD", geckoId };
}

// ─── CoinGecko helper ─────────────────────────────────────────────────────────

async function fetchCoinGeckoPrice(geckoId: string) {
  const url =
    `https://api.coingecko.com/api/v3/coins/markets` +
    `?vs_currency=usd&ids=${geckoId}&order=market_cap_desc&per_page=1&page=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as Array<Record<string, number>>;
  const data = json[0];
  if (!data) throw new Error(`No data returned for ${geckoId}`);
  return {
    price: data["current_price"] ?? 0,
    change24h: data["price_change_percentage_24h"] ?? 0,
    high24h: data["high_24h"] ?? 0,
    low24h: data["low_24h"] ?? 0,
    volume24h: data["total_volume"] ?? 0,
  };
}

// ─── CryptoPanic RSS helper ───────────────────────────────────────────────────

interface NewsItem {
  headline: string;
  source: string;
  url: string;
  publishedAt: string;
}

async function fetchCoinDeskNews(base: string): Promise<NewsItem[]> {
  const res = await fetch("https://feeds.feedburner.com/CoinDesk", {
    headers: { Accept: "application/rss+xml, text/xml, */*" },
  });
  if (!res.ok) throw new Error(`CoinDesk RSS error ${res.status}`);
  const xml = await res.text();

  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;

  /** Extract tag value, handles CDATA and plain text */
  const tag = (block: string, name: string) => {
    const t = new RegExp(
      `<${name}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${name}>|<${name}[^>]*>([^<]*)<\\/${name}>`
    );
    const r = block.match(t);
    return r ? (r[1] ?? r[2] ?? "").trim() : "";
  };

  // Build search terms: e.g. BTC → ["BTC", "Bitcoin", "bitcoin"]
  const geckoId = COINGECKO_ID[base.toUpperCase()];
  const fullName = geckoId ? geckoId.charAt(0).toUpperCase() + geckoId.slice(1) : base;
  const searchTerms = [base.toUpperCase(), fullName, fullName.toLowerCase()];

  // Also check <category> tags in the item block
  const categoryRegex = /<category[^>]*>(?:<!\[CDATA\[)?([^\]<]+)(?:\]\]>)?<\/category>/g;

  while ((m = itemRegex.exec(xml)) !== null && items.length < 5) {
    const block = m[1];
    const headline = tag(block, "title");
    if (!headline) continue;

    const url = tag(block, "link") || tag(block, "guid");
    const publishedAt = tag(block, "pubDate");
    const source = "coindesk.com";

    // Collect all category values for this item
    const categories: string[] = [];
    let cm: RegExpExecArray | null;
    const catRegexLocal = new RegExp(categoryRegex.source, "g");
    while ((cm = catRegexLocal.exec(block)) !== null) {
      categories.push(cm[1].trim());
    }
    const combined = `${headline} ${categories.join(" ")}`.toLowerCase();

    if (searchTerms.some((t) => combined.includes(t.toLowerCase()))) {
      items.push({ headline, source, url, publishedAt });
    }
  }

  // Fallback: return first 5 general items if no coin-specific matches
  if (items.length === 0) {
    const fallbackRegex = /<item>([\s\S]*?)<\/item>/g;
    let fb: RegExpExecArray | null;
    while ((fb = fallbackRegex.exec(xml)) !== null && items.length < 5) {
      const block = fb[1];
      const headline = tag(block, "title");
      const url = tag(block, "link") || tag(block, "guid");
      const publishedAt = tag(block, "pubDate");
      if (headline) items.push({ headline, source: "coindesk.com", url, publishedAt });
    }
  }

  return items;
}

// ─── Claude helpers ───────────────────────────────────────────────────────────

/** Lazily create Anthropic client so missing key only errors on actual use */
function getAnthropic(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set in environment");
  return new Anthropic({ apiKey: key });
}

async function claudeSentiment(
  pair: string,
  headlines: NewsItem[]
): Promise<{ score: number; label: "BULLISH" | "BEARISH" | "NEUTRAL"; rationale: string }> {
  const headlineText = headlines.map((h, i) => `${i + 1}. ${h.headline}`).join("\n");
  const prompt = `You are a crypto market analyst. Based on the following recent news headlines for ${pair}, score the overall market sentiment on a scale from -1.0 (very bearish) to +1.0 (very bullish). Respond with ONLY a JSON object in this exact format:
{"score": <number between -1.0 and 1.0>, "label": "<BULLISH|BEARISH|NEUTRAL>", "rationale": "<one sentence max>"}

Headlines:
${headlineText}`;

  const msg = await getAnthropic().messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 150,
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";
  // Extract JSON even if Claude wraps it in markdown
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text) as {
    score: number;
    label: "BULLISH" | "BEARISH" | "NEUTRAL";
    rationale: string;
  };
  return parsed;
}

async function claudeBias(
  pair: string,
  price: number,
  change24h: number,
  sentimentScore: number,
  sentimentRationale: string
): Promise<{
  signal: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  rationale: string;
  keyLevels: { support: number; resistance: number };
}> {
  const prompt = `You are a professional crypto trading analyst. Produce a directional bias for ${pair} based on:
- Current price: $${price.toFixed(2)}
- 24h change: ${change24h.toFixed(2)}%
- Sentiment score: ${sentimentScore.toFixed(2)} (range -1.0 to +1.0)
- Sentiment rationale: ${sentimentRationale}

Respond with ONLY a JSON object in this exact format:
{"signal": "<BULLISH|BEARISH|NEUTRAL>", "confidence": "<HIGH|MEDIUM|LOW>", "rationale": "<2 sentences max>", "keyLevels": {"support": <number>, "resistance": <number>}}

Estimate key support and resistance levels as round numbers near the current price.`;

  const msg = await getAnthropic().messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : text) as {
    signal: "BULLISH" | "BEARISH" | "NEUTRAL";
    confidence: "HIGH" | "MEDIUM" | "LOW";
    rationale: string;
    keyLevels: { support: number; resistance: number };
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
    version: "day2",
    network: "stellar:testnet",
    payTo: SERVER_WALLET_ADDRESS,
    price: "$0.01 USDC per call",
    endpoints: [
      "GET /market/:pair",
      "GET /news/:pair",
      "GET /sentiment/:pair",
      "GET /bias/:pair",
      "POST /deliver/email",
      "POST /deliver/telegram",
    ],
  });
});

// ─── x402 middleware: all six routes ─────────────────────────────────────────

app.use(
  paymentMiddleware(
    {
      "GET /market/*": {
        accepts: { scheme: "exact", payTo: SERVER_WALLET_ADDRESS, price: "$0.01", network: "stellar:testnet" },
        description: "Live OHLCV market data via CoinGecko",
      },
      "GET /news/*": {
        accepts: { scheme: "exact", payTo: SERVER_WALLET_ADDRESS, price: "$0.01", network: "stellar:testnet" },
        description: "Latest crypto news headlines via CryptoPanic RSS",
      },
      "GET /sentiment/*": {
        accepts: { scheme: "exact", payTo: SERVER_WALLET_ADDRESS, price: "$0.01", network: "stellar:testnet" },
        description: "Claude-powered sentiment score from live headlines",
      },
      "GET /bias/*": {
        accepts: { scheme: "exact", payTo: SERVER_WALLET_ADDRESS, price: "$0.01", network: "stellar:testnet" },
        description: "Claude directional bias: signal, confidence, key levels",
      },
      "POST /deliver/email": {
        accepts: { scheme: "exact", payTo: SERVER_WALLET_ADDRESS, price: "$0.01", network: "stellar:testnet" },
        description: "Deliver a trading brief via email (Resend)",
      },
      "POST /deliver/telegram": {
        accepts: { scheme: "exact", payTo: SERVER_WALLET_ADDRESS, price: "$0.01", network: "stellar:testnet" },
        description: "Deliver a trading brief via Telegram bot",
      },
    },
    resourceServer
  )
);

// ─── GET /market/:pair ────────────────────────────────────────────────────────

app.get("/market/:pair", async (req, res) => {
  try {
    const { base, quote, geckoId } = parsePair(req.params["pair"] ?? "BTC-USD");
    const data = await fetchCoinGeckoPrice(geckoId);
    res.json({
      pair: `${base}-${quote}`,
      price: data.price,
      change24h: parseFloat(data.change24h.toFixed(4)),
      high24h: data.high24h,
      low24h: data.low24h,
      volume24h: data.volume24h,
      timestamp: Date.now(),
      source: "coingecko",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});

// ─── GET /news/:pair ──────────────────────────────────────────────────────────

app.get("/news/:pair", async (req, res) => {
  try {
    const { base } = parsePair(req.params["pair"] ?? "BTC-USD");
    const items = await fetchCoinDeskNews(base);
    res.json({ pair: req.params["pair"]?.toUpperCase(), count: items.length, items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});

// ─── GET /sentiment/:pair ─────────────────────────────────────────────────────

app.get("/sentiment/:pair", async (req, res) => {
  try {
    const { base } = parsePair(req.params["pair"] ?? "BTC-USD");
    const pairStr = req.params["pair"]?.toUpperCase() ?? "BTC-USD";
    const headlines = await fetchCoinDeskNews(base);
    if (headlines.length === 0) {
      return res.json({ pair: pairStr, score: 0, label: "NEUTRAL", rationale: "No recent headlines found." });
    }
    const sentiment = await claudeSentiment(pairStr, headlines);
    return res.json({ pair: pairStr, ...sentiment });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: msg });
  }
});

// ─── GET /bias/:pair ──────────────────────────────────────────────────────────

app.get("/bias/:pair", async (req, res) => {
  try {
    const { base, quote, geckoId } = parsePair(req.params["pair"] ?? "BTC-USD");
    const pairStr = `${base}-${quote}`;

    const [market, headlines] = await Promise.all([
      fetchCoinGeckoPrice(geckoId),
      fetchCoinDeskNews(base),
    ]);

    let sentimentScore = 0;
    let sentimentRationale = "Insufficient news data.";
    if (headlines.length > 0) {
      const s = await claudeSentiment(pairStr, headlines);
      sentimentScore = s.score;
      sentimentRationale = s.rationale;
    }

    const bias = await claudeBias(pairStr, market.price, market.change24h, sentimentScore, sentimentRationale);
    return res.json({ pair: pairStr, ...bias, timestamp: Date.now() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: msg });
  }
});

// ─── POST /deliver/email ──────────────────────────────────────────────────────

app.post("/deliver/email", async (req, res) => {
  const { to, subject, body } = req.body as { to?: string; subject?: string; body?: string };
  if (!to || !subject || !body) {
    return res.status(400).json({ error: "Missing required fields: to, subject, body" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("\n[deliver/email] FALLBACK — No RESEND_API_KEY set. Would have sent:");
    console.log(`  To: ${to}\n  Subject: ${subject}\n  Body: ${body}\n`);
    return res.json({ delivered: false, reason: "No API key — logged to console", timestamp: Date.now() });
  }

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: "StellarBrief <brief@stellarbrief.app>",
      to,
      subject,
      text: body,
    });
    return res.json({ delivered: true, timestamp: Date.now() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: msg });
  }
});

// ─── POST /deliver/telegram ───────────────────────────────────────────────────

app.post("/deliver/telegram", async (req, res) => {
  const { chatId, message } = req.body as { chatId?: string; message?: string };
  if (!chatId || !message) {
    return res.status(400).json({ error: "Missing required fields: chatId, message" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("\n[deliver/telegram] FALLBACK — No TELEGRAM_BOT_TOKEN set. Would have sent:");
    console.log(`  Chat ID: ${chatId}\n  Message: ${message}\n`);
    return res.json({ delivered: false, reason: "No API key — logged to console", timestamp: Date.now() });
  }

  try {
    const telegramRes = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
      }
    );
    if (!telegramRes.ok) {
      const errText = await telegramRes.text();
      throw new Error(`Telegram API ${telegramRes.status}: ${errText}`);
    }
    return res.json({ delivered: true, timestamp: Date.now() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: msg });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[dataServer] Running on http://localhost:${PORT}`);
  console.log(`[dataServer] payTo:       ${SERVER_WALLET_ADDRESS}`);
  console.log(`[dataServer] price:       $0.01 USDC per call`);
  console.log(`[dataServer] network:     stellar:testnet`);
  console.log(`[dataServer] facilitator: https://www.x402.org/facilitator`);
});

export { app };
