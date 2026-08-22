# Outcharity

Outcharity is a public advertising leaderboard where rank is determined by confirmed lifetime contributions. The application serves HTML at the edge, stores two financial entities in D1, stores logos in R2, uses Stripe Checkout for payment, and records the charity portion through GoodAPI.

## Runtime

- One Hono application on Cloudflare Workers
- D1 for advertisers and immutable contribution amounts
- R2 for validated PNG, JPEG, and WebP logos
- Cloudflare Cache API for five-second leaderboard caching
- Stripe Checkout and signed webhooks
- GoodAPI charity donations with provider-side idempotency

The browser receives ordinary HTML and CSS. JavaScript is limited to amount shortcuts and copy/share controls.

The locked production Worker bundle was 109.41 KiB compressed at the latest deployment. There are
two runtime packages: Hono supplies hardened routing and HTML escaping with no transitive packages,
and Stripe's official library supplies Checkout and webhook-signature handling with no transitive
packages. Wrangler is a development and deployment tool; it and its toolchain do not ship to
visitors.

## Safety gate

Checkout remains closed unless all required charity details, Stripe secrets, the GoodAPI secret, both Cloudflare rate-limit bindings, the canonical production origin, and `OUTCHARITY_LAUNCH_APPROVED=true` are present. This prevents an unfinished, unprotected, or unapproved campaign from accepting money.

Version 1 is locked to a 90% charity allocation and a 10% platform allocation. A conflicting runtime value keeps checkout closed and cannot change the public promise. Fractional cents are rounded in the charity's favor. Outcharity absorbs payment-processing fees rather than subtracting them from the charity amount.

The public wording comes from the standalone-model approval received from GoodAPI's founder.
`GOODAPI_EMAIL.txt` preserves the exact request, and `PLAN.md` records the approval and verified
production configuration.

## Local verification

A fresh clone uses `npm ci`. The focused release commands are `npm test`, `npm run check`, and
`npm run build`; local development uses `npm run dev`, and the local D1 migration command is
`npm run db:local`. The build script passes `/dev/null` as Wrangler's environment file so the
production bundle check never loads a dotenv file.

Application secrets belong in Cloudflare's encrypted Wrangler secret storage. Non-secret campaign wording belongs in `wrangler.jsonc`. Do not place credentials or campaign overrides in dotenv files.

## Production resources

`wrangler.jsonc` identifies the production `outcharity` D1 database and the private
`outcharity-logos` R2 bucket. It contains only non-secret campaign configuration; provider
credentials remain encrypted Cloudflare Worker secrets.

Cloudflare Workers Logs supplies error monitoring. Cloudflare Web Analytics is enabled through
automatic injection for non-EU visitors, without adding an analytics package to the application.

Wrangler publishes only the `outcharity.com` custom domain; public `workers.dev` and preview URLs are disabled. GitHub dependency alerts and automatic security updates are enabled. GitHub does not offer native secret scanning for this private repository under the current account features, so the checksum-pinned, MIT-licensed Gitleaks scanner checks full history on every push and pull request until native push protection becomes available.

GoodAPI Donations is activated, the production charity record is verified, the live provider key
is stored as a Worker secret, and the complete flow passed a disposable sandbox rehearsal. Keep
`OUTCHARITY_LAUNCH_APPROVED=false` until the remaining Phase 6 checks and the explicit Phase 7
cutover authorization are complete.

## Current launch status

Production is deployed at `https://outcharity.com`, but Checkout is deliberately locked. The
current homepage presents an honest open #1 position because production has zero advertisers and
zero contributions. `PLAN.md` is the durable launch checklist, and `HANDOFF.md` records the latest
deployment evidence and exact continuation point.

## Payment integrity

- The signed Stripe webhook is authoritative; redirects never create contributions.
- The Checkout Session ID is unique, so duplicate webhook delivery counts once.
- Advertiser totals are recalculated by a database trigger inside the same transactional batch.
- Confirmed financial fields cannot be updated or deleted.
- Charity delivery uses the Checkout Session ID as the provider idempotency key.
- Failed charity deliveries are logged, returned as webhook failures for Stripe retry, and retried by the 15-minute scheduled task.
- Expired new-listing Checkout Sessions delete their unused uploaded logos.
- Logos are served only for confirmed, visible advertisers and cached for at most one minute, so hiding a listing also revokes its public image promptly.
- Public leaderboard HTML is cached for five seconds; successful webhook insertion invalidates the local edge copy immediately.
