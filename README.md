# EarnLoop

A rewards platform where **shops pay to run ads, surveys and offers**, and **users earn a share** of every payment. Nothing is pre-loaded: all campaigns are created by shops through the app.

Built with React (Vite), Node.js + Express, and SQLite.

## How the money flows

1. A shop signs up, pays the platform owner by UPI, and submits the amount and transaction reference.
2. The admin confirms the payment, which credits the shop's ad funds.
3. The shop creates a campaign (ad, survey or offer), choosing the payout per completion, the user's share (30-80%) and a maximum number of completions.
4. The admin reviews and approves it. It then appears for users.
5. When a user completes it, the shop's balance is debited, the user is credited their share, and the platform keeps the difference.
6. Users withdraw to UPI (minimum ₹100). The admin pays them and marks the request as paid.

All money is stored in **paise as integers** to avoid floating point errors, and every balance change happens inside a database transaction.

## Roles

| Role | Can do |
| --- | --- |
| User | Browse offers, complete them, withdraw |
| Shop | Add funds, create / pause / resume campaigns, see spend |
| Admin | Confirm payments, approve campaigns, pay withdrawals, see margin |

## Anti-fraud rules (server-side)

- One completion per user per campaign (database unique constraint)
- Minimum time on task, measured from a server-recorded start time
- Surveys need every question answered
- 15 completions per user per 24 hours
- Campaigns stop automatically when the cap or the shop's funds run out
- Every campaign is reviewed before going live

## Run it

```bash
npm install          # installs server and client
npm run dev          # API on :3000, web on http://localhost:5173
npm test             # API tests
```

Production: `npm run build && npm start` (the server serves the built client).

Set these environment variables before real use:

| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | Signing key for login tokens |
| `ADMIN_USER`, `ADMIN_PASS` | The admin account created on first run (default `admin` / `admin123`, change it) |
| `PORT` | API port, default 3000 |

## API overview

`POST /api/auth/register|login` · `GET /api/campaigns` · `POST /api/campaigns/:id/start|complete` · `POST /api/withdrawals` · `POST /api/shop/campaigns` · `POST /api/shop/topups` · `GET /api/admin/overview` · `POST /api/admin/{campaigns|topups|withdrawals}/:id/:action`

## Known limitations and roadmap

- **Offer completion is time-based.** For app installs or sign-ups, real verification needs a postback (server-to-server callback) from the advertiser. Next step: per-campaign postback URLs.
- Payments are manual (UPI reference confirmed by the admin). Next step: a payment gateway such as Razorpay.
- SQLite for simplicity. Swap for PostgreSQL for production.
- Add device and IP checks, email or phone verification, and rate limiting.
- Check the legal side before paying real users: KYC, TDS, and the rules for rewards and online gaming in India.

## Project layout

```
server/   Express API, SQLite schema, tests
client/   React app (Vite)
```
