// ─────────────────────────────────────────────────────────────────────────────
// x402.market — Pay-per-call API server
// Every endpoint charges USDC. AI agents pay automatically. You profit.
//
// Stack:  Node.js + Express + @x402/express v2.3.0 + @x402/evm v2.9.0
// Docs:   https://docs.cdp.coinbase.com/x402/quickstart-for-sellers
// ─────────────────────────────────────────────────────────────────────────────

import express     from "express";
import cors        from "cors";
import dotenv      from "dotenv";
import fetch       from "node-fetch";
import Anthropic   from "@anthropic-ai/sdk";

import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme }                        from "@x402/evm/exact/server";
import { HTTPFacilitatorClient }                 from "@x402/core/server";

dotenv.config();

// ── Config ────────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT       || 4021;
const PAY_TO      = process.env.WALLET_ADDRESS;
const NETWORK     = process.env.NETWORK    || "eip155:84532";
const FACILITATOR = process.env.FACILITATOR_URL
                 || "https://facilitator.x402.org";

if (!PAY_TO) {
  console.error("Set WALLET_ADDRESS in your .env file");
  process.exit(1);
}

// ── Earnings tracker ──────────────────────────────────────────────────────────
const earnings = { total: 0, calls: {}, log: [] };
function record(endpoint, amount, query) {
  earnings.total += amount;
  earnings.calls[endpoint] = (earnings.calls[endpoint] || 0) + 1;
  earnings.log.unshift({ endpoint, amount, query, ts: new Date().toISOString() });
  if (earnings.log.length > 500) earnings.log.pop();
  console.log(`  ${endpoint}  +$${amount.toFixed(4)} USDC  (total: $${earnings.total.toFixed(4)})`);
}

// ── Anthropic client ──────────────────────────────────────────────────────────
const ai = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ── App + x402 setup ──────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR });
const resourceServer    = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactEvmScheme());

app.use(
  paymentMiddleware(
    {
      "GET /api/weather": {
        accepts: { scheme:"exact", price:"$0.003", network:NETWORK, payTo:PAY_TO },
        description: "Current weather for any city",
        mimeType:    "application/json",
      },
      "GET /api/stocks": {
        accepts: { scheme:"exact", price:"$0.005", network:NETWORK, payTo:PAY_TO },
        description: "Real-time stock quote",
        mimeType:    "application/json",
      },
      "GET /api/crypto": {
        accepts: { scheme:"exact", price:"$0.002", network:NETWORK, payTo:PAY_TO },
        description: "Live crypto price",
        mimeType:    "application/json",
      },
      "GET /api/research": {
        accepts: { scheme:"exact", price:"$0.025", network:NETWORK, payTo:PAY_TO },
        description: "Claude-powered research answer",
        mimeType:    "application/json",
      },
    },
    resourceServer,
  )
);

// ── Paid route handlers ───────────────────────────────────────────────────────

app.get("/api/weather", async (req, res) => {
  const city = req.query.city || "Miami";
  try {
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
    ).then(r => r.json());
    if (!geo.results?.length) return res.status(404).json({ error: "City not found" });
    const { latitude, longitude, name, country } = geo.results[0];
    const wx = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph`
    ).then(r => r.json());
    const codes = { 0:"Clear",1:"Mostly Clear",2:"Partly Cloudy",3:"Overcast",45:"Foggy",61:"Rain",71:"Snow",80:"Showers",95:"Thunderstorm" };
    record("/api/weather", 0.003, city);
    res.json({ city:name, country, temp_f:wx.current.temperature_2m, humidity_pct:wx.current.relative_humidity_2m, wind_mph:wx.current.wind_speed_10m, condition:codes[wx.current.weather_code]||"Unknown" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/stocks", async (req, res) => {
  const ticker = (req.query.ticker || "AAPL").toUpperCase();
  try {
    const data = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1d`, { headers:{"User-Agent":"Mozilla/5.0"} }).then(r => r.json());
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta) return res.status(404).json({ error: "Ticker not found" });
    const change = (meta.regularMarketPrice - meta.previousClose).toFixed(2);
    record("/api/stocks", 0.005, ticker);
    res.json({ ticker, price:meta.regularMarketPrice.toFixed(2), change, change_pct:((change/meta.previousClose)*100).toFixed(2)+"%", exchange:meta.exchangeName });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/crypto", async (req, res) => {
  const input = (req.query.asset || "bitcoin").toLowerCase();
  const idMap  = { btc:"bitcoin", eth:"ethereum", sol:"solana", usdc:"usd-coin", matic:"matic-network", arb:"arbitrum" };
  const id = idMap[input] || input;
  try {
    const data = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`).then(r => r.json());
    if (!data[id]) return res.status(404).json({ error: "Asset not found" });
    record("/api/crypto", 0.002, input.toUpperCase());
    res.json({ asset:input.toUpperCase(), price_usd:data[id].usd, change_24h:data[id].usd_24h_change?.toFixed(2)+"%", market_cap:"$"+(data[id].usd_market_cap/1e9).toFixed(1)+"B" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/research", async (req, res) => {
  const question = req.query.q;
  if (!question) return res.status(400).json({ error: "Provide ?q=your+question" });
  if (!ai)       return res.status(503).json({ error: "Set ANTHROPIC_API_KEY in .env" });
  try {
    const msg = await ai.messages.create({
      model:"claude-sonnet-4-20250514", max_tokens:300,
      system:"You are a concise factual research API. Answer in 2-4 sentences.",
      messages:[{ role:"user", content:question }],
    });
    record("/api/research", 0.025, question.slice(0,60));
    res.json({ question, answer:msg.content[0].text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Free endpoints ────────────────────────────────────────────────────────────

app.get("/", (req, res) => res.json({
  name: "x402.market",
  network: NETWORK,
  endpoints: [
    { path:"/api/weather",  price:"$0.003", example:"?city=Miami"      },
    { path:"/api/stocks",   price:"$0.005", example:"?ticker=NVDA"     },
    { path:"/api/crypto",   price:"$0.002", example:"?asset=ETH"       },
    { path:"/api/research", price:"$0.025", example:"?q=What+is+Base"  },
  ],
}));

app.get("/earnings", (req, res) => res.json({
  total_usdc: earnings.total.toFixed(6),
  calls:      earnings.calls,
  recent:     earnings.log.slice(0, 20),
}));

app.get("/health", (req, res) => res.json({ ok:true }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\nx402.market running on http://localhost:${PORT}`);
  console.log(`Wallet:  ${PAY_TO}`);
  console.log(`Network: ${NETWORK}\n`);
});
