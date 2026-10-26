# Economy

## Names people see

The database calls the two units **coins** (bought, sent as gifts: `coin_balance`, `coin_price`,
`gift_coins`) and **diamonds** (the host's share, withdrawable: `earnings`). The app shows each
brand's own names from `brand.json` → `units` (helpers `U` and `units()` in `src/lib/brand.ts`):

| Database | Zynalive shows | Icon |
|---|---|---|
| coins (viewers buy and send) | **Diamonds** | blue diamond (`Coin` in `ui.tsx`) |
| diamonds (hosts earn and withdraw) | **Beans** | golden bean (`Bean` in `ui.tsx`) |

Server notification texts still say coins/diamonds; the app swaps the words when showing them.

## Money path (purchase)

Implemented in `internal_credit_payment()`; split percentages live in
`platform_settings.purchase_split` (basis points) so they can change without a
deploy. Every allocation is a `platform_ledger` row and they always sum to the
amount paid (tested).

```
User pays 3,000 PKR
 ├─ Agency margin 400 (13.33%)          only when payments.agency_id is set
 └─ Platform 2,600
     ├─ Coin reserve 2,000 (76.92%)     backs the coins in circulation
     └─ Internal allocation 600
         ├─ LiveKit reserve 360 (60%)
         └─ Owner revenue 240 (40%)     (rounding remainders land here)
```

### Stripe Checkout settings (coins-checkout)

- **Zynalive's own payment page** (`public/pay/index.html` → zynalive.com/pay): with the
  `STRIPE_PUBLISHABLE_KEY` secret set (same test/live mode as the secret key), `coins-checkout`
  creates the session in Elements mode (`ui_mode: 'elements'`, API `2026-08-26.dahlia`, buyer's
  profile email as `customer_email`) and returns `zynalive.com/pay#cs=…&pk=…&ret=…&back=…`. The
  page loads Stripe.js from js.stripe.com, shows the package and total from the session and Stripe's
  Payment Element (card details go straight to Stripe), and confirms the session. Everything is in
  the URL fragment (never sent to a server) and removed from the address bar on load; it only
  returns to Zynalive addresses. The web app and the Android app open it the same way they opened
  Stripe's page, and crediting is unchanged (webhook / reconciliation on the same Checkout session).
  Without the publishable key, buyers get Stripe's hosted page as before.
- Payment methods chosen by Stripe from the Dashboard settings (cards, Link
  and others; no hard-coded list), **Adaptive Pricing** on (buyers abroad see a local-currency
  price; `amount_total`/`currency` on the session stay in the package currency, so the webhook's
  amount check still holds — Stripe API 2025-03-31 and later).
- Sessions expire 62 minutes after their payment row was created; `checkout.session.expired` and
  `checkout.session.async_payment_failed` close the pending payment as `failed`
  (`internal_fail_payment`, `20261013010000_payment_expired.sql`). A paid payment is never changed.
- Each checkout is created with an idempotency key (`checkout:<payment id>`), so a retried request
  can't open a second Stripe session for the same payment.
- **No double payments on retries** (`20261015010000_checkout_reuse.sql`): `internal_create_payment`
  takes a per-buyer lock and returns the buyer's existing pending payment for the same package if
  it is under 30 minutes old, instead of a new one. `coins-checkout` then hands back that payment's
  open Stripe page. If that page was already paid but the webhook hasn't credited it yet, it
  answers 409 `payment_processing` (never a second page); if it expired unpaid, the payment is
  closed `failed` and a fresh one starts. A dropped connection, double tap or app restart therefore
  always lands on the same Stripe page, and the webhook credits each payment once.
- **Reconciliation** (`payments-reconcile`, `20261017010000_payment_reconcile.sql`): coins don't
  depend on the webhook alone. When the buyer opens the Wallet (and after returning from Stripe) the
  server asks Stripe about their open payments and applies the same rule as the webhook
  (`_shared/payments.ts`): paid → `internal_credit_payment` (amount-checked, credits once, so a webhook
  arriving later changes nothing), expired → `internal_fail_payment`. Payments whose Stripe page was
  never created are closed after 2 hours (`internal_expire_unstarted_payments`).

### Stripe plan (from Stripe's implementation planner, 2026-10-12)

Business: US company, Stripe only. Next steps, in order:
1. **Coins** (done): hosted Checkout + Link + dynamic payment methods + Adaptive Pricing.
2. **VIP membership** (Billing, to build): one flat monthly price paid up front through hosted
   Checkout (`mode: subscription`), the Stripe Customer Portal for cancel / card changes, Smart
   Retries and failed-payment emails on (Dashboard → Billing → Revenue recovery).
3. **Host payouts** (to build): Zynalive is a marketplace and the platform owns pricing and losses.
   Hosts in Pakistan can't be paid through Connect cross-border payouts (US/UK/EEA/CA/CH only); Stripe
   **Global Payouts** reaches Pakistani bank accounts (`pk_bank_account`) from a US platform.
4. **Tax**: free threshold monitoring (product tax category + head-office address in the Dashboard).

## Gift engine (coins)

`send_gift()` splits `coins_total` using `platform_settings.gift_split`:

| Share | % | Goes to |
|---|---|---|
| Host | 90 | `creator_earnings.balance` (+ `earning_entries`) |
| Stream | 5 | `streams.pool_coins` (plus rounding remainder) |
| Owner | 5 | `platform_ledger` bucket `gift_owner_share` |

Hot rows: the host's share, the stream totals, PK scores and event scores are first written to
`private.gift_tallies` (append-only, so simultaneous gifts to one host never wait on each other) and
then folded into `creator_earnings` / `streams` / `pk_battles` / `event_scores` by whichever gift
gets the row with `SKIP LOCKED`. Withdrawals, chargeback clawbacks, ending a stream or a PK battle,
and finalizing an event fold the pending tallies exactly first; screens may trail by the gifts in
flight (the Earnings screen calls `settle_my_earnings()` first). See `docs/LOAD_TEST.md`.

Guarantees (all covered by `supabase/tests/10_must_pass.sql`):

- The sender's wallet row is locked (`FOR UPDATE`) for the whole transaction.
- `(sender_id, idempotency_key)` is unique; a retry returns the original gift
  and charges nothing. 8 parallel identical requests charge exactly once.
- `wallets.coin_balance >= 0` is a CHECK constraint — overdraw is impossible.
- Frozen wallets (open chargeback) cannot spend.
- The client supplies only room, gift id, quantity (1–999) and the key; price
  comes from `gift_catalog`.

## Profile frames (coin shop)

Users buy profile frames with coins; the frame shows around their photo on Me and their public
profile. `buy_frame(frame_id, idempotency_key)`:

- price and duration come from `frame_catalog` (never from the app); `duration_days` null = permanent,
  otherwise each purchase adds that many days to the time left (renew);
- locks the buyer's wallet, dedupes on `(user_id, idempotency_key)` (a retry returns the first
  purchase and charges nothing), refuses restricted accounts, frozen wallets, unknown/inactive frames,
  re-buying a permanent frame and short balances;
- one transaction: `frame_purchases` row, `coin_transactions` (`kind = 'frame_purchase'`),
  `user_frames` ownership, and the coins booked to `platform_ledger` bucket `frame_sales` (100% owner
  revenue; hosts get nothing from frame sales).

`equip_frame(frame_id | null)` wears an owned, unexpired frame (or takes it off); `profiles.active_frame_id`
has no client write grant. Clients can only read the catalog and ownership. Covered in `10_must_pass.sql`.
Frames aren't refundable; if coins used for a frame are charged back, the normal chargeback path
records the shortfall and flags the account.

## Withdrawals

`request_withdrawal(coins, payout_method)` moves coins from
`creator_earnings.balance` to `held`; owners approve (held → paid out) or reject
(held → back to balance; also possible after approval if the payout failed);
`mark_withdrawal_paid` records the payout reference and notifies the host.
`my_withdrawable_coins()` shows hosts what they can withdraw now (gifts newer than
`withdrawal.hold_days` stay on hold).

**Open question (from the architecture):** the coin → PKR rate that bridges
the gift tree and the PKR revenue tree is not defined. It is a setting
(`platform_settings.withdrawal.pkr_per_coin`, editable in the command center)
and **withdrawals are disabled until an owner sets it**. Sanity check when
choosing it: 3,000 PKR funds a 2,000 PKR coin reserve; a host receives 90% of
gifted coins, so the rate must keep `payouts ≤ coin reserve` for the package
pricing in `coin_packages`.

## Refunds & chargebacks

| Event | Effect |
|---|---|
| User refund request → owner approves (`review_refund`) | Payment → `refunded`; purchased coins reversed (up to current balance). Then refund in Stripe; the `charge.refunded` webhook is a no-op for an already-refunded payment. |
| Refund issued directly in Stripe | Webhook → `internal_refund_payment` reverses coins. |
| Dispute opened | Payment → `disputed`; wallet frozen. |
| Dispute won | Payment → `paid`; wallet unfrozen if no other open disputes. |
| Dispute lost | Coins reversed up to balance; platform ledger debited (`chargeback_loss`); account flagged (`account_review`). |

Any shortfall (coins already spent) is recorded as a negative platform-ledger
entry and the account is flagged for review.

**Clawback.** When the reversed coins were already gifted, the hosts' share of the gifts the
buyer sent after the purchase is taken back from their earnings, oldest gift first (coins are
spent oldest first). Each gift records `clawed_coins`, so no gift is clawed twice. This is
deliberately conservative: if the buyer also had older coins, the clawed gifts may have been
paid partly with those. Earnings never go negative: anything a host already withdrew or has
requested flags them (`account_review`) for the owner to check their pending withdrawals.

## Regional pricing

Each region has its own coin packages (`coin_packages.region`): PKR for
Pakistan, INR for India, BDT for Bangladesh and USD for Global (UK, the rest
of the world, and markets not launched yet). A buyer's region is derived from
`profiles.signup_country` — recorded server-side at sign-up and frozen — not
from the editable `profiles.country`. The Wallet shows only the buyer's region (`my_region()`;
Global if unknown). `internal_create_payment()` (and
`PaymentsService.createPayment` in the NestJS API) refuses a package from
another region, so nobody can buy a cheaper market's coins
(`10_must_pass.sql` §4b). Buyers with no recorded sign-up country fall back
to Global pricing. The purchase split above applies per payment in its own
currency; the withdrawal rate (`pkr_per_coin`) is still PKR-only, and
withdrawals are enabled per region (`regions.features.withdrawals`: PK only).

## Event rewards

Engagement events (gifting races, PK battle leagues) only *read* the gift and
battle rows through triggers; they never move coins. Rewards are recorded in
`event_results` and announced to winners. Any coin prize is paid by an owner
through the normal admin path, not by the event system.
