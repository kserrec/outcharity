# Security notes

Outcharity's threat model and the deliberate trust decisions behind it. Audits should read this
first so settled decisions are not re-reported unless something has changed.

## Reporting a vulnerability

Do not open a public GitHub issue for a suspected vulnerability. Email
[`hello@outcharity.com`](mailto:hello@outcharity.com) with the affected code or endpoint, the
potential impact, and the shortest reproduction you have. Use a local environment whenever
possible; do not probe production in a way that creates a real payment, accesses another person's
data, or disrupts the service. The maintainer will coordinate remediation and disclosure through
the same private email thread.

## What the code defends

- Money is counted only from Stripe webhook events whose signature verifies and whose amount,
  currency, and server-written metadata all agree. Browser redirects never create records.
- Outside local development, checkout opens only with a live-mode Stripe key, and the webhook
  refuses any event that is not live-mode (and any event whose mode disagrees with the key), so
  a test-mode configuration can never turn fake payments into real listings or charity deliveries.
- Listing text, URLs, and logos are validated server-side: HTTP(S)-only links without
  credentials, control characters and invisible direction/zero-width marks stripped (joiners
  that emoji and Persian/Indic scripts need are kept), logos checked by file signature and by
  the pixel dimensions declared in their headers (at most 2048 × 2048), and
  stored under server-chosen keys. Logos are served only for confirmed, visible listings.
- Form posts require a matching `Origin` header and pass per-client rate limits keyed on the
  IPv4 address or the IPv6 /64 block. The management credential is returned to the browser only
  in a `__Host-` HttpOnly cookie, which the success and return pages read; form posts never
  depend on it.
- Request bodies are capped while streaming; unreadable bodies are refused with 400.
- Outbound Stripe calls time out after 20 seconds with one retry; GoodAPI calls after 10 seconds.
- Strict Content Security Policy, HSTS, frame denial, and `nosniff` on every response; private
  pages additionally send `Referrer-Policy: origin`, `no-store`, and `noindex`.
- **Money never leaves before it is safe.** The charity share is not sent at payment time; the
  scheduled task sends it only once the payment is older than `CHARITY_HOLD_DAYS` (30) and has no
  recorded refund or dispute. A refunded or disputed payment (`charge.refunded`,
  `charge.dispute.created`) is written to `payment_suspensions` — even if that event arrives
  before the payment's own confirmation, and even if it names only the charge rather than the
  payment intent (the charge is then resolved through Stripe's API) — and a suspended payment is never delivered and its
  listing is hidden until Kyle reviews it. The payment record itself stays immutable. Partial
  refunds suspend too; the Terms only ever promise full refunds. A suspended payment is also
  removed from the listing's rank total (`total_contributed_cents`), so rank never includes
  refunded money even if the listing is later un-hidden.
- **Chargeback liability.** Stripe Checkout requests 3-D Secure on every card payment
  (`request_three_d_secure: 'any'`). When the issuer supports it, the authenticated payment's
  fraud chargeback is the issuer's liability under card-network rules, not Outcharity's; a card
  not enrolled in 3-D Secure proceeds without it (Stripe offers a Radar rule to block such cards
  if that exposure ever proves real). The Terms make payments final after the hold window, which
  is the basis for contesting any later non-fraud dispute. A dispute that still succeeds after
  delivery, or a refund Kyle chooses to issue after the hold, is the residual exposure; the
  $100,000 contribution cap (`MAX_CONTRIBUTION_CENTS`) bounds it per payment.

## Known trust decisions (accepted, not findings)

1. **Management links carry their credential in the URL.** A listing is managed through
   `/manage/<64-hex token>`; whoever holds the link can pay more on that listing (and nothing
   else). The token is stored only as a SHA-256 hash. Because the URL is the credential, it will
   sit in the owner's browser history and would appear in any per-request URL log. Mitigations:
   Cloudflare invocation logs are disabled (`observability.logs.invocation_logs: false` in
   `wrangler.jsonc`), the Worker never logs request URLs itself, private pages send at most the
   site origin as a referrer, and analytics scripts are blocked on private pages. Accepted
   2026-08-21.
2. **Listings appear on the leaderboard the moment payment confirms; moderation is reactive.**
   The Terms reserve the right to hide any listing; hiding is a manual D1 update of `is_hidden`
   or the automatic refund/dispute rule above.
3. **HSTS is sent without `includeSubDomains` or `preload`.** Adding either would bind every
   future `*.outcharity.com` host to HTTPS; that is Kyle's call when a subdomain exists.
4. **The leaderboard has no listing cap.** Every listing costs at least the minimum contribution,
   so growth is paid for; the 5-second edge cache bounds render cost.

5. **Every refund or dispute on the Stripe account records a suspension row**, including for
   payments Outcharity never saw, because a suspension may legitimately arrive before its own
   confirmation. Rows for unknown payments touch no listing; the table grows only with the
   account's own refund volume. The Stripe account is dedicated to Outcharity. Accepted
   2026-08-21.
6. **A won dispute does not lift its suspension automatically.** `charge.dispute.closed` is not
   handled; after winning a dispute Kyle deletes the `payment_suspensions` row (which restores
   the money to the listing's rank total via trigger) and un-hides the listing by hand.
   Accepted 2026-08-21.

## Audit history

- 2026-08-21 — full audit: live-mode-only production rule, logo dimension cap, IPv6 rate-limit
  buckets, invisible-character stripping, 400 on unreadable bodies, Stripe timeout, refund/dispute
  auto-hide with early-event suspensions, 30-day charity delivery hold, mandatory 3-D Secure,
  $100,000 per-payment cap, invocation logs disabled. A cold review of the first
  batch found the mode guard blocked only mixed modes, a refund-before-confirmation race, and
  over-broad character stripping; all three were fixed. All fixes carry regression tests.
- 2026-08-21 (second pass, pre-release) — independent adversarial audit found no proven finding.
  Hardening applied: an expired Checkout Session can no longer delete a logo that a confirmed
  listing owns. Decisions 5 and 6 recorded.
