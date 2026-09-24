# Economy

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

## Gift engine (coins)

`send_gift()` splits `coins_total` using `platform_settings.gift_split`:

| Share | % | Goes to |
|---|---|---|
| Host | 90 | `creator_earnings.balance` (+ `earning_entries`) |
| Stream | 5 | `streams.pool_coins` (plus rounding remainder) |
| Owner | 5 | `platform_ledger` bucket `gift_owner_share` |

Guarantees (all covered by `supabase/tests/10_must_pass.sql`):

- The sender's wallet row is locked (`FOR UPDATE`) for the whole transaction.
- `(sender_id, idempotency_key)` is unique; a retry returns the original gift
  and charges nothing. 8 parallel identical requests charge exactly once.
- `wallets.coin_balance >= 0` is a CHECK constraint — overdraw is impossible.
- Frozen wallets (open chargeback) cannot spend.
- The client supplies only room, gift id, quantity (1–999) and the key; price
  comes from `gift_catalog`.

## Withdrawals

`request_withdrawal(coins, payout_method)` moves coins from
`creator_earnings.balance` to `held`; owners approve (held → paid out) or reject
(held → back to balance); `mark_withdrawal_paid` records the payout reference.

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
