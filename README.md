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

The deployable Worker bundle is about 107 KB compressed. There are two runtime packages: Hono supplies hardened routing and HTML escaping with no transitive packages, and Stripe's official library supplies Checkout and webhook-signature handling with no transitive packages. Wrangler is a development and deployment tool; it and its toolchain do not ship to visitors.

## Safety gate

Checkout remains closed unless all required charity details, Stripe secrets, the GoodAPI secret, and `OUTCHARITY_LAUNCH_APPROVED=true` are present. This prevents an unfinished or unapproved campaign from accepting money.

Version 1 is locked to a 90% charity allocation and a 10% platform allocation. A conflicting runtime value keeps checkout closed and cannot change the public promise. Fractional cents are rounded in the charity's favor. Outcharity absorbs payment-processing fees rather than subtracting them from the charity amount.

The public wording must come from the written approval received from the charity-compliance provider. `GOODAPI_EMAIL.txt` contains the exact request.

## Local verification

The four local commands are `npm install`, `npm run db:local`, `npm test`, and `npm run dev`. The production bundle check is `npm run build`.

Application secrets belong in Cloudflare's encrypted Wrangler secret storage. Non-secret campaign wording belongs in `wrangler.jsonc`. Do not place credentials or campaign overrides in dotenv files.

## Production resources

The zero UUID in `wrangler.jsonc` is an inert local placeholder. Creating the production D1 database with Wrangler's `--update-config` option replaces it with the real Cloudflare database identifier. The R2 bucket name is `outcharity-logos`.

Cloudflare Workers Logs supplies initial error monitoring. Cloudflare Web Analytics can be enabled from the Cloudflare dashboard without adding browser code.

GoodAPI's charity-donation documentation requires a one-time subscription activation before live donation calls work. Do that only after GoodAPI confirms the standalone agreement, full price, charity eligibility, required public wording, refund process, and exact compliance coverage. Do not enable `OUTCHARITY_LAUNCH_APPROVED` until those answers and the final terms are in place.

## Payment integrity

- The signed Stripe webhook is authoritative; redirects never create contributions.
- The Checkout Session ID is unique, so duplicate webhook delivery counts once.
- Advertiser totals are recalculated by a database trigger inside the same transactional batch.
- Confirmed financial fields cannot be updated or deleted.
- Charity delivery uses the Checkout Session ID as the provider idempotency key.
- Failed charity deliveries are logged, returned as webhook failures for Stripe retry, and retried by the 15-minute scheduled task.
- Expired new-listing Checkout Sessions delete their unused uploaded logos.
- Public leaderboard HTML is cached for five seconds; successful webhook insertion invalidates the local edge copy immediately.
