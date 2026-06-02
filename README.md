**English** | [中文文档](README.zh-CN.md)

# AI-CreditCardMaintenance

> AI-CreditCardMaintenance is an offline-capable PWA to track credit card spending, repayments, and utilization across multiple cards, backed by Supabase.

**Live demo:** https://ai-credit-card-maintenance.vercel.app

![PWA](https://img.shields.io/badge/PWA-offline--capable-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Stack](https://img.shields.io/badge/stack-vanilla%20JS%20%2B%20Supabase-orange)

---

## Why

Managing several credit cards by hand is error-prone: it is easy to lose track of which card has the longest interest-free window, forget a repayment deadline, or accidentally push utilization above the threshold that damages your credit profile. This app gives you a single dashboard that keeps all of that straight — no spreadsheet, no heavyweight finance app.

---

## Features

- **Multi-card management** — store credit limit, billing date, due date, and last-four digits per card
- **Transaction log** — record spending, repayments, and refunds; attach a fee rate preset so the service charge is auto-calculated
- **Period overview** — billing-cycle spending, current balance, utilization rate, and days left in the cycle for every card
- **Best-card recommendation** — picks the card with the longest remaining interest-free window (days to next statement + 20-day grace period)
- **Repayment planner** — two-stage strategy: bring utilization to 60–70 % before the statement date, then clear the balance two days before the due date
- **Card health metrics** — per-cycle transaction count, average transaction interval, top-merchant share, and scene diversity; each metric is compared against your configured targets
- **Fee rate presets** — save merchant/platform combinations with their fee rates; reuse them when logging a transaction
- **Spending trend chart** — month-to-date cumulative spending line chart (Chart.js)
- **Supabase Auth** — email/password login; each user's data is isolated by RLS
- **Offline localStorage fallback** — if Supabase is unreachable the app reads from and writes to `localStorage` automatically; data syncs back on the next successful connection
- **Dark mode** — system preference respected; toggle available in Settings
- **PWA / Add to Home Screen** — installable on iOS and Android

---

## Quick Start (use the hosted demo)

Open https://ai-credit-card-maintenance.vercel.app in any modern browser, register an account, and add your first card. No installation required.

---

## Deploy Your Own

If you want your data stored in your own Supabase project:

### 1. Create a Supabase project

Go to https://supabase.com, create a new project, and note your **Project URL** and **anon key**.

### 2. Create the table and enable RLS

Run the following SQL in the Supabase SQL Editor:

```sql
-- Create the table
create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  content jsonb not null default '{}'::jsonb
);

-- Enable Row Level Security
alter table public.user_data enable row level security;

-- Policy: each user can only read and write their own row
create policy "Users can read own data"
  on public.user_data
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own data"
  on public.user_data
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own data"
  on public.user_data
  for update
  using (auth.uid() = user_id);

create policy "Users can delete own data"
  on public.user_data
  for delete
  using (auth.uid() = user_id);
```

### 3. Point the frontend at your Supabase project

Open `creditcardapp/app.js` and replace the two constants near the top:

```js
const supabaseUrl = 'YOUR_PROJECT_URL';
const supabaseKey = 'YOUR_ANON_KEY';
```

### 4. Serve the app

There is no build step. You can:

- Drop the `creditcardapp/` folder on any static host (Vercel, Netlify, Cloudflare Pages, nginx …)
- Or open `creditcardapp/index.html` directly in a browser for local use

---

## Usage

| Page | What you do |
|------|-------------|
| Overview | See KPIs, today's recommended card, repayment plan |
| Cards | Add / edit cards; view per-card utilization and repayment stages |
| Transactions | Log spending, repayments, and refunds; filter by card or period |
| Presets | Save fee-rate presets for recurring merchants or platforms |
| Settings | Dark mode, data export/reset, logout |

**Recording a transaction:**
1. Tap **+** (FAB) or **Log entry** in the desktop nav.
2. Select card, date, and amount.
3. Choose type: Spending / Repayment / Refund.
4. (Optional) Pick a fee-rate preset; the service charge is calculated automatically.
5. Tap **Confirm**.

---

## Compared to Alternatives

| | AI-CreditCardMaintenance | Spreadsheet | General expense app |
|--|--|--|--|
| Multi-card utilization tracking | Yes | Manual | Rarely |
| Interest-free window recommendation | Yes (per cycle) | Manual | No |
| Two-stage repayment planner | Yes | No | No |
| Card health metrics (tx count, interval, merchant diversity) | Yes | No | No |
| Offline fallback | Yes (localStorage) | N/A | Varies |
| No-build, zero-dependency frontend | Yes | N/A | N/A |
| Self-hostable | Yes | N/A | Varies |

---

## FAQ

**Where is my data stored? Is it safe?**
Your data is stored in Supabase (`user_data.content` as JSONB) and mirrored in your browser's `localStorage`. Supabase enforces Row Level Security: each user can only access their own row. A local backup is always available offline.

**Can I use the app without deploying Supabase?**
Yes. The app falls back to `localStorage` automatically when Supabase is unavailable. You lose cross-device sync but all features work locally.

**How do I deploy my own backend?**
See the [Deploy Your Own](#deploy-your-own) section above.

**How is the interest-free window calculated?**
The app counts the number of calendar days from today to the next statement date, then adds a fixed 20-day grace period (`GRACE_DAYS = 20` in `app.js`). The card with the largest total is recommended. This is a rule-of-thumb heuristic — your actual grace period depends on your card issuer.

**How is utilization calculated?**
`utilization = net balance / credit limit`, where `net balance = initial balance + spending − refunds − repayments` within the current billing cycle.

**How does the repayment planner work?**
The planner (`computeRepaymentStrategy` in `calc.js`) produces two stages:
1. Two days after the statement date: pay down to ~65 % utilization if you are above 70 %.
2. Two days before the due date: clear the remaining balance to avoid interest.

---

## Security Note

The Supabase `anon` key visible in `app.js` is the **public client key** — it is designed to be embedded in frontend code. Security is provided entirely by Row Level Security (RLS) policies in Supabase, not by keeping the key secret.

**If you deploy your own instance, verify that RLS is enabled on `user_data` before exposing the app.** Without RLS any authenticated user can read every other user's data.

The hosted demo at `ai-credit-card-maintenance.vercel.app` uses the author's Supabase project; do not store sensitive financial data there.

---

## Requirements

- Any modern browser (Chrome, Safari, Firefox, Edge)
- A Supabase project (optional; the app works offline without one)
- No Node.js, no build tool — the app is plain HTML + ES modules loaded from CDN

---

## License

MIT — see [LICENSE](LICENSE).
