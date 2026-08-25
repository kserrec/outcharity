# Outcharity

Outcharity is a public advertising leaderboard where rank is determined by confirmed lifetime contributions. The application serves HTML at the edge, stores two financial entities in D1, stores logos in R2, uses Stripe Checkout for payment, and records the charity portion through GoodAPI.

## Runtime

- One Hono application on Cloudflare Workers
- D1 for advertisers, immutable contribution amounts, and daily aggregate visit totals
- R2 for validated PNG, JPEG, and WebP logos
- Cloudflare Cache API for five-second homepage and stats caching
- Cloudflare Turnstile with mandatory server-side verification on both checkout forms
- Stripe Checkout and signed webhooks
- GoodAPI charity donations with provider-side idempotency

The browser receives ordinary HTML and CSS. Application-owned JavaScript is limited to amount
shortcuts and copy/share controls; Cloudflare automatically injects its existing Web Analytics
measurement script for non-European visits. The visual system uses local system-font stacks, so no
third-party font service or font download is added to the page.

The public `/stats` page reads one current D1 statement for total paid, the currently counted
charity allocation, counted payments, visible advertisers, average payment, Cloudflare-recorded
website visits, and charity-delivery status. Money and payment counts include only eligible
contributions from advertisers currently visible on the board, so hidden listings and refunded or
disputed payments do not affect that campaign snapshot.

The delivery ledger separately preserves every recorded charity share, including aggregate history
from listings later hidden. Each share is exactly one of: accepted by GoodAPI with a donation
record, awaiting GoodAPI after the verification hold or a failed attempt, or stopped before
delivery because its payment was refunded or disputed. Provider acceptance does not claim
Outcharity independently observed the charity's bank receipt. No individual payment or provider
identifier is published.

A visit is an entry from a direct link or another website, not a unique person or every page view.
Cloudflare excludes bots, and the configured automatic injection does not collect European visits.
Outcharity stores only daily aggregate totals—never an individual visit, IP address, browser detail,
or tracking identifier.

The server-rendered `/help` page gives visitors useful paths even when they do not want a
leaderboard listing: the featured charity's official donation page, GiveWell research and pooled
giving, IRS and FTC verification guidance, and blood, food-bank, and volunteer searches. They are
plain external links without affiliate or campaign query parameters. Outcharity does not process
those outside donations or collect whether a visitor completes an outside action.

The live production Worker bundle is 109.41 KiB compressed at the launch deployment. There are
two runtime packages: Hono supplies hardened routing and HTML escaping with no transitive packages,
and Stripe's official library supplies Checkout and webhook-signature handling with no transitive
packages. Wrangler is a development and deployment tool; it and its toolchain do not ship to
visitors.

## Safety gate

Checkout remains closed unless all required charity details, Stripe secrets, the GoodAPI secret,
both Cloudflare rate-limit bindings, the Turnstile site key, encrypted Turnstile secret and exact
hostname allowlist, the canonical production origin, and `OUTCHARITY_LAUNCH_APPROVED=true` are
present. This prevents an unfinished, unprotected, or unapproved campaign from accepting money.

New version 1 Checkout Sessions are locked to a 95% charity allocation and a 5% platform
allocation. A conflicting runtime value keeps checkout closed and cannot change the public
promise. Fractional cents are rounded in the charity's favor. Outcharity absorbs payment-processing
fees rather than subtracting them from the charity amount. Earlier open sessions and existing
immutable contribution rows retain the allocation recorded when checkout began, including the
original 90/10 split; public copy and aggregate-stat explanations distinguish those amounts from
the current split.

GoodAPI's founder approved the standalone advertising model. `GOODAPI_EMAIL.txt` preserves the
exact original request—including its initial 90/10 split—and `PLAN.md` records that approval, the
verified production history, and the later 95/5 change.

## Local verification

A fresh clone uses `npm ci`. The focused release commands are `npm test`, `npm run check`, and
`npm run build`; local development uses `npm run dev`, and the local D1 migration command is
`npm run db:local`. The build script passes `/dev/null` as Wrangler's environment file so the
production bundle check never loads a dotenv file.

Application secrets belong in Cloudflare's encrypted Wrangler secret storage. Non-secret campaign wording belongs in `wrangler.jsonc`. Do not place credentials or campaign overrides in dotenv files.

## Production resources

`wrangler.jsonc` identifies the production `outcharity` D1 database and the private
`outcharity-logos` R2 bucket. It contains only non-secret campaign configuration; provider
credentials remain encrypted Cloudflare Worker secrets. The separate Cloudflare analytics token
has read-only Account Analytics permission and is likewise stored only as a Worker secret.

Cloudflare Workers Logs supplies error monitoring. Cloudflare Web Analytics is enabled through
automatic injection for non-EU visitors, without adding an analytics package to the application.
The existing 15-minute scheduled event refreshes the stored daily aggregates at most about once an
hour; analytics failures are logged without interrupting charity delivery or replacing the last
successful count.

Wrangler publishes only the `outcharity.com` custom domain; public `workers.dev` and preview URLs
are disabled. The account is on Workers Free, where Cloudflare enforces a fixed 10-millisecond CPU
ceiling per invocation and a 100,000-request daily limit instead of metered Workers request or CPU
overages. Expensive public cache misses plus private lookups share an aggregate per-location cost
brake to preserve D1 availability before its daily Free-plan limit and to reduce R2 operations,
which can incur usage charges after their monthly free tier. Cloudflare's Free-plan zone rate-limit
slot also stops an IP at the edge after five requests to either checkout path in ten seconds, before
the Worker runs; Turnstile and the Worker-side brakes cover the distributed traffic that this
per-IP, per-location rule cannot. GitHub dependency alerts, automatic security updates, native
secret scanning, and push protection are enabled. The checksum-pinned Gitleaks scanner also checks
the repository's full history on every push and pull request.

GoodAPI Donations is activated, the production charity record is verified, the live provider key
is stored as a Worker secret, and the complete flow passed a disposable sandbox rehearsal. The
explicit Phase 7 cutover authorization is complete, `OUTCHARITY_LAUNCH_APPROVED=true` is the
version-controlled production setting, and the live health endpoint confirms Checkout is enabled.

## Current launch status

Production is live at `https://outcharity.com`, and genuine Stripe Checkout is enabled. The
homepage renders its leaderboard from confirmed production contributions rather than fixed sample
content. `PLAN.md` is the durable launch checklist, and `HANDOFF.md` records the latest deployment
evidence and exact continuation point.

## Payment integrity

- The signed Stripe webhook is authoritative; redirects never create contributions.
- The Checkout Session ID is unique, so duplicate webhook delivery counts once.
- Advertiser totals are recalculated by a database trigger inside the same transactional batch.
- Confirmed financial fields cannot be updated or deleted.
- The charity share is held for `CHARITY_HOLD_DAYS` (30) after payment and then sent by the 15-minute scheduled task; a payment refunded or disputed inside that window sends nothing to charity. Failed deliveries are logged and retried on later runs.
- Charity delivery uses the Checkout Session ID as the provider idempotency key.
- Checkout requests 3-D Secure authentication on every card payment (`request_three_d_secure: 'any'`). When the issuer supports it, fraud-chargeback liability for that payment sits with the card issuer under card-network rules; cards not enrolled in 3-D Secure proceed without it and remain the one residual fraud exposure.
- Expired new-listing Checkout Sessions delete their unused uploaded logos.
- Logos are served only for confirmed, visible advertisers and cached for at most one minute, so hiding a listing also revokes its public image promptly.
- Public homepage and stats HTML are cached for five seconds; successful webhook insertion invalidates both local edge copies immediately.
- A signed `charge.refunded` or `charge.dispute.created` event hides the affected listing, removes that payment from the listing's rank total and from the public totals, and invalidates the local edge copies of the homepage, stats page, and logo; the payment record itself is never altered. A suspension that arrives before the payment's confirmation is stored and applied when the confirmation lands, and a suspended payment never sends money to charity.
- Outside local development, checkout requires a live-mode Stripe key and the webhook refuses non-live events, so a test-mode configuration can never create a live listing or charity delivery.
- Both checkout forms require a fresh Cloudflare Turnstile proof. The backend independently checks
  the proof's success, route-specific action, exact approved hostname, maximum length, and
  connecting IP before any D1, R2, or Stripe work.

`SECURITY.md` records the threat model, the accepted trust decisions, and the audit history.

## Contributing

Bug reports and pull requests are welcome in the
[GitHub repository](https://github.com/kserrec/outcharity). Keep changes focused, add or update
tests for behavior changes, and run the release checks before opening a pull request:

```sh
npm test
npm run check
npm run build
git diff --check
```

Report suspected vulnerabilities privately using the instructions in [`SECURITY.md`](SECURITY.md),
not through a public issue. Contributions accepted into this repository are licensed under the
same MIT License as the project.

## License

Outcharity is open source software available under the [MIT License](LICENSE). The
`"private": true` package setting prevents accidental publication to the npm registry; it does not
restrict use of the source code under the MIT License.
