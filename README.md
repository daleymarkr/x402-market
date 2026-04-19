# ⬡ x402.market

Pay-per-call API marketplace. AI agents pay USDC. You collect.  
Built on [x402](https://docs.cdp.coinbase.com/x402/welcome) by Coinbase.

---

## What this is

A Node.js server that puts 4 useful APIs behind a USDC paywall.  
Any AI agent (or human) with a funded wallet can call them — no accounts, no API keys, no subscriptions.  
You earn USDC for every request. Coinbase's x402 facilitator handles payment verification.

**Endpoints:**

| Route | Price | Data source |
|---|---|---|
| `GET /api/weather?city=Miami` | $0.003 | Open-Meteo (free) |
| `GET /api/stocks?ticker=AAPL` | $0.005 | Yahoo Finance (free) |
| `GET /api/crypto?asset=ETH` | $0.002 | CoinGecko (free) |
| `GET /api/research?q=question` | $0.025 | Claude (Anthropic API) |

---

## Setup (5 minutes)

### 1. Clone and install

```bash
git clone https://github.com/your-username/x402-market
cd x402-market
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:
```
WALLET_ADDRESS=0xYourWalletAddress   # where USDC lands
NETWORK=base-sepolia                  # testnet to start
ANTHROPIC_API_KEY=sk-ant-...          # only needed for /api/research
```

### 3. Run

```bash
npm run dev
```

Server starts at `http://localhost:4021`.  
Check `/earnings` to see your revenue.

---

## Testing on testnet (free, no real money)

1. Get a wallet — [Coinbase Wallet](https://wallet.coinbase.com) or MetaMask
2. Get testnet USDC — [CDP Faucet](https://docs.cdp.coinbase.com/faucets/introduction/quickstart)
3. Call an endpoint with payment:

```bash
# Using the x402 client CLI (from @x402/cli)
npx @x402/cli get http://localhost:4021/api/weather?city=Tokyo \
  --private-key YOUR_PRIVATE_KEY \
  --network base-sepolia
```

Or use the x402 TypeScript client in your agent:

```typescript
import { withPaymentRequired } from "@x402/client";

const response = await withPaymentRequired(
  () => fetch("http://localhost:4021/api/weather?city=Tokyo"),
  { privateKey: process.env.AGENT_PRIVATE_KEY }
);
const data = await response.json();
```

---

## Going to mainnet (real USDC)

1. Change `.env`:
   ```
   NETWORK=base
   FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
   ```

2. Add CDP API keys (for the production facilitator):
   ```
   CDP_API_KEY_NAME=...
   CDP_API_KEY_PRIVATE_KEY=...
   ```
   Get them at [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com)

3. Fund your receiving wallet with some ETH for gas

4. Deploy to Railway / Fly.io / Render (all support Node.js, ~$5/mo)

---

## Revenue math

| Daily agent calls | At avg $0.009/call | Monthly |
|---|---|---|
| 1,000 | $9/day | $270 |
| 10,000 | $90/day | $2,700 |
| 100,000 | $900/day | $27,000 |

First 1,000 tx/month free via CDP facilitator. Then $0.001/tx.

---

## Add your own endpoint

The pattern is the same for any data source:

```js
// 1. Add the route to paymentMiddleware config
"GET /api/yourroute": Resource({
  price:   "$0.01",
  network: Network(NETWORK),
  desc:    "What this returns",
}),

// 2. Implement the handler
app.get("/api/yourroute", async (req, res) => {
  const data = await yourDataSource(req.query);
  record("/api/yourroute", 0.01, req.query.param);
  res.json(data);
});
```

---

## Stack

- [Express](https://expressjs.com/) — HTTP server
- [@x402/express](https://www.npmjs.com/package/@x402/express) — payment middleware
- [Open-Meteo](https://open-meteo.com/) — weather data (free, no key)
- [Yahoo Finance](https://finance.yahoo.com/) — stock data (free, no key)
- [CoinGecko](https://coingecko.com/) — crypto data (free tier)
- [Anthropic SDK](https://www.npmjs.com/package/@anthropic-ai/sdk) — AI research

---

Built with [Coinbase Developer Platform](https://cdp.coinbase.com)  
x402 docs: [docs.cdp.coinbase.com/x402](https://docs.cdp.coinbase.com/x402/welcome)
