# Outcharity launch plan

## Launch rule

Ship the existing version 1; do not add features while launching. Keep one Worker, one D1
database, one R2 bucket, and the existing Stripe and GoodAPI integrations. Add no application
dependency, API client generator, analytics script, admin interface, queue, or permanent staging
environment unless a real launch probe proves the current design insufficient.

The production `OUTCHARITY_LAUNCH_APPROVED` value stays `false` through every setup and rehearsal
phase. The disposable Phase 5 Worker also starts locked and may use `true` only after its isolated
test configuration is verified, solely for the controlled sandbox Checkout; this never changes
the production value. Secrets go only into the providers' secret stores through Kyle's own
interactive terminal or dashboards; they never enter the repository or chat. Account creation,
identity verification, nameserver changes, and secret entry are Kyle-owned manual actions and are
walked one step at a time.

## Verified starting state — 2026-08-21

- The local product exists and implements Stripe Checkout, signed webhook fulfillment, immutable
  D1 contribution records, R2 logos, a 90/10 allocation, GoodAPI delivery with idempotency, and a
  15-minute retry task.
- The exact GoodAPI donation request already matches the live OpenAPI 3.1 specification: raw
  `Authorization` header, integer `amount_cents`, charity EIN, stable idempotency key, attribution,
  and non-personal metadata.
- GoodAPI's founder authorized the standalone Outcharity model, confirmed that St. Jude is
  supported, said GoodAPI handles the downstream charitable donations, quoted $49 per month, and
  activated the Donations dashboard. Kyle accepts that response as the required provider
  permission; no additional permission email is planned.
- The Git working tree is clean at commit `098242e`, and the local branch points at the same commit
  as `origin/main`.
- All 41 tests pass; the syntax check and dry production build pass. The current upload is
  108.63 KiB compressed.
- The only runtime packages are Hono 4.13.3 and Stripe 22.5.0, with no installed transitive runtime
  packages. `npm audit --omit=dev` reports zero known vulnerabilities. No new package is planned.
- `wrangler.jsonc` still contains the inert D1 identifier, localhost origin, empty campaign values,
  and a closed launch switch. No production Cloudflare resource has been verified.
- `outcharity.com` uses Namecheap nameservers. HTTP currently forwards to `www.outcharity.com`,
  HTTPS does not respond, and `www` is parked. Namecheap email-forwarding MX records exist, but
  delivery to `hello@outcharity.com` is unverified.
- Kyle owns the domain at Namecheap and already has a Cloudflare account used for other projects;
  `outcharity.com` has not been added to it and its remote resources remain unverified. Kyle has
  not yet located a Stripe account. Phase 5 later confirms that an existing account is available.

## Phase 1 — Local product

- [x] Minimal Cloudflare Worker application and server-rendered public pages
- [x] Stripe Checkout and authoritative signed-webhook fulfillment
- [x] D1 financial integrity, R2 logo validation, ranking, and cache invalidation
- [x] GoodAPI delivery, provider idempotency, failure recording, and scheduled retry
- [x] Launch gate, legal-page placeholders, security headers, rate limits, and critical-path tests
- [x] Correctness, security, and test-suite reviews with no known finding left open

## Phase 2 — GoodAPI authorization

- [x] Send GoodAPI the exact standalone advertising model and launch questions
- [x] Receive written authorization from GoodAPI's founder for the standalone model and St. Jude
- [x] Confirm the $49 monthly price and the responsibility split: Outcharity makes one API call for
  each confirmed purchase and GoodAPI handles the downstream charitable donation
- [x] Activate the Donations dashboard

Exit: GoodAPI access and provider permission are complete. Canonical charity data, public campaign
copy, and the operational refund policy are finalized during test-mode rehearsal and locked
production configuration; they do not require another permission email.

## Phase 3 — Put the domain on Cloudflare

- [x] Verify that two-factor authentication is enabled on Kyle's existing Cloudflare account
- [x] Kyle adds `outcharity.com` to that account; this creates no application data and does not
  move the domain registration away from Namecheap
- [x] Inventory the Cloudflare zone, Worker, D1 databases, and R2 buckets before creating anything:
  the zone exists, the exact `outcharity` Worker does not exist, the D1 list is empty, and the R2
  API reports that R2 has not been enabled on this account
- [x] Verify Cloudflare imported the current Namecheap mail-forwarding DNS records before changing
  nameservers: all five `eforward` MX records and the SPF TXT record are present
- [x] Kyle replaces the Namecheap nameservers with the two nameservers assigned by Cloudflare;
  the `.com` registry now delegates to `bart.ns.cloudflare.com` and `cruz.ns.cloudflare.com`
- [x] Replace the unconfigured Namecheap mail records with Cloudflare Email Routing, verify its
  authoritative MX, SPF, and DKIM records, create the `hello@outcharity.com` forwarding rule to a
  verified destination, and receive a real test message through that route
- [x] Kyle authenticates the installed Wrangler command-line tool from his own interactive terminal;
  a subsequent `wrangler whoami` probe succeeds
- [x] Configure a proxied originless `www` record, deploy a permanent redirect to
  `https://outcharity.com` that preserves paths and query strings, enable Always Use HTTPS, and
  verify both public redirect hops

Exit: Cloudflare is authoritative for the domain, email forwarding still works, the apex is the
canonical host, and Wrangler is authenticated. No checkout is open.

## Phase 4 — Deploy the closed production foundation

- [x] Kyle enables R2 Object Storage in the Cloudflare dashboard after reviewing its usage billing;
  a subsequent R2 inventory succeeds
- [x] Create the empty `outcharity` D1 database and private Standard-class `outcharity-logos` R2
  bucket after the inventory proves neither exists, then verify both in a second inventory
- [x] Replace only the inert D1 identifier in `wrangler.jsonc` and set `SITE_URL` to
  `https://outcharity.com`; keep campaign values empty until they are verified and keep
  `OUTCHARITY_LAUNCH_APPROVED=false`
- [x] Apply `db/migrations/0001_initial.sql` to the production D1 database; Kyle handles Wrangler's
  interactive confirmation in his own terminal
- [x] Deploy the Worker to the apex custom domain with checkout closed
- [x] Verify the certificate, apex and `www` behavior, `/health` reporting
  `checkoutEnabled: false`, public pages, sitemap, robots file, assets, security headers, D1 and R2
  bindings, scheduled retry trigger, and Worker logs
- [x] Enable Cloudflare Web Analytics with automatic injection excluding EU visitors, without
  adding a browser analytics package; allowlist only its Cloudflare script origin in the Content
  Security Policy

Exit: the real domain serves the complete pre-launch site over HTTPS, storage and observability
work, and accepting money remains impossible.

## Phase 5 — Run one disposable end-to-end rehearsal

- [x] Kyle locates his existing Stripe account, enables two-step authentication, and opens a Stripe
  sandbox; live business and payout approval can continue separately while testing proceeds
- [x] Confirm that GoodAPI exposes separate test and production keys; never paste either key into
  chat or commit it
- [x] Create the disposable `outcharity-rehearsal` Worker and D1 database plus the private
  `outcharity-rehearsal-logos` R2 bucket from
  `/tmp/outcharity-rehearsal-cli/wrangler.jsonc`; verify
  the migrated database is empty and checkout remains locked without adding permanent staging
  configuration to the repository
- [x] Register the temporary Stripe sandbox webhook at
  `https://outcharity-rehearsal.kserrec.workers.dev/webhooks/stripe` for
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and
  `checkout.session.expired`
- [x] Kyle enters the Stripe sandbox secret, sandbox webhook signing secret, and GoodAPI test key
  into the temporary Worker's secret store
- [x] Search GoodAPI for St. Jude: its directory returns `St Jude Childrens Research Hospital`
  with EIN `620646012`; use the independently verified official `https://www.stjude.org` link
  because GoodAPI does not display a website URL
- [x] Set `OUTCHARITY_LAUNCH_APPROVED=true` only in the disposable Worker after verifying its
  test-only charity configuration and all three secret bindings; independently verify production
  remains locked before starting the sandbox Checkout
- [x] Complete one Stripe sandbox Checkout with a Stripe test card and the GoodAPI test key; no
  card-network payment or charitable funds move
- [x] Verify the exact 90/10 cents, D1 row, leaderboard rank, logo, GoodAPI donation record, public
  cache refresh, and successful Worker logs
- [x] Resend the same signed Stripe webhook and repeat the same GoodAPI idempotency key; verify one
  contribution and one donation record, not duplicates
  - Evidence from disposable Worker version `03d7659f-113c-4887-8639-a6c6d9d75b18` on
    2026-08-21: both signed webhook deliveries returned `200`; D1 retained one advertiser, one
    contribution, a `1000`-cent leaderboard total, one Stripe session, one `900`-cent GoodAPI
    donation, and one GoodAPI delivery attempt; the logo returned `200 image/png`
- [x] Remove the temporary webhook, Worker, D1 database, R2 bucket, and temporary config after the
  evidence is recorded

Exit: the real providers have completed the entire flow once in their test environments, no real
money moved, no test row entered production, and no permanent staging system remains.

## Phase 6 — Wire production while locked

- [x] Verify the dedicated live Stripe account is ready: Account Status says `Verified`, Stripe
  shows no red banner or business/payout warning, the payout bank can receive funds, the customer
  statement descriptor is `OUTCHARITY`, and two-factor authentication is enabled
  - Stripe's current live-account interface does not expose separate support-email, support-phone,
    or support-website fields for this account; those fields are nonexistent in the observed UI,
    not incomplete. The optional paid Stripe Verified product is not required and was not enabled
- [x] Create and enable the live parent-account webhook at
  `https://outcharity.com/webhooks/stripe` with snapshot payloads, API version
  `2026-07-29.dahlia`, and exactly `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`, and `checkout.session.expired`
- [x] Kyle stores `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `GOODAPI_API_KEY` through
  Wrangler's interactive secret prompts; a subsequent name-only inventory confirms exactly those
  three encrypted bindings and no secret appears in a command, file, log, or chat
  - `STRIPE_SECRET_KEY` contains a restricted live key with only Checkout Sessions write access;
    webhook signature verification remains local and needs no Stripe API permission
- [x] Set the locked production campaign to GoodAPI's verified
  `St Jude Childrens Research Hospital` record, EIN `620646012`, the independent official
  `https://www.stjude.org` URL, the generic campaign headline, and Kyle's approved literal
  disclosure of non-affiliation, the 90/10 gross split, and Outcharity-paid processing fees
- [x] Publish Kyle's approved refund and dispute policy: rank changes and rule-breaking listings do
  not earn refunds; confirmed duplicate/unauthorized charges, billing errors, failure to provide a
  listing, or removal of a compliant listing are reviewed for full Stripe refunds to the original
  payment method; Outcharity bears unrecoverable charity and processing costs; provider-record
  correction is explicitly separate from reversing funds; open card disputes follow their own
  Stripe/card-network process; nonwaivable legal rights remain intact
- [x] Deploy Worker version `d247957b-709e-4102-b446-fec279df64f6` with
  `OUTCHARITY_LAUNCH_APPROVED=false`
  - Pre-deploy verification passed 43/43 tests, JavaScript syntax checking, and Wrangler's dry
    production build at 108.98 KiB compressed
  - Live probes confirm the approved Terms and Privacy pages, `Referrer-Policy: same-origin`, the
    expected Content Security Policy, `/health` returning `checkoutEnabled: false`, and a direct
    Checkout POST returning `503`; retained logs show the deployed version handled the probes with
    outcome `ok` and no exceptions
  - A read-only production D1 query confirms zero advertisers, zero contributions, and zero writes
- [x] Use the GoodAPI production key for a search-only `GET /charities/search?ein=620646012`; the
  live response returned `St Jude Childrens Research Hospital`, EIN `620646012`, nonprofit ID
  `n_6JeFQADP9Hq6qEAHcPqhsfEi`, and website `WWW.STJUDE.ORG` without calling the donation endpoint
  or recording a live donation
- [x] Send one locally signed synthetic `checkout.session.completed` event directly to the live
  Stripe webhook endpoint and verify that it accepts the signature without creating a contribution
  - Stripe's observed current webhook-destination page did not offer a synthetic-event action, so
    no Dashboard event was sent. A purpose-built temporary script outside the repository accepted
    the existing signing secret through a hidden terminal prompt and made exactly one webhook POST;
    it made no Stripe API request and created no Checkout Session or payment
  - The production endpoint returned HTTP `200` with
    `{"received":true,"counted":false}`. A subsequent read-only production D1 query found zero
    advertisers and zero contributions, with zero changes and zero rows written; `/health` still
    returned `{"ok":true,"checkoutEnabled":false}`
- [x] Put the leaderboard at the center of the homepage before launch: make the real #1 listing
  visually dominant, group #2 and #3 as a mobile podium visible in the first phone viewport, keep
  the full logo/name/card surface linked to each advertiser's submitted website, and present an
  honest high-impact `#1 is open` state while production has no advertisers
  - No fake listing, activity feed, visitor count, click count, analytics dependency, or runtime
    package was added. Populated local fixtures were inspected at 1440, 390, and 320 CSS pixels;
    the locked production state was inspected at desktop and mobile sizes
  - Rendering tests prove the top-three DOM hierarchy, exact full-card destinations, new-tab and
    sponsored-link attributes, and the locked empty state without a submission link
- [x] Deploy the homepage polish in Worker version `5aea4953-5738-4a32-98fa-c2b9846527e5` with
  `OUTCHARITY_LAUNCH_APPROVED=false`
  - Pre-deploy verification passed 45/45 tests, JavaScript syntax checking, `git diff --check`, and
    Wrangler's dry production build at 109.41 KiB compressed; Worker startup is 6 ms
  - Live desktop and mobile screenshots match the approved locked hierarchy. The homepage returns
    `200`, `/health` returns `{"ok":true,"checkoutEnabled":false}`, and a direct Checkout POST
    returns `503`
  - Retained logs identify the new version with outcome `ok` and no exceptions for homepage and
    health probes. A read-only D1 query still returns zero advertisers and zero contributions;
    Cloudflare reports `changes: 0`, `rows_written: 0`, and `changed_db: false`
- [x] Reverify the final Terms and Privacy pages, Worker logs, and `/health` still reporting
  `checkoutEnabled: false` after the locked homepage deployment
- [x] Reverify `hello@outcharity.com` delivery and the final Stripe and GoodAPI dashboard status
  - Kyle sent the final launch-delivery message and confirmed that it arrived at the configured
    destination inbox on 2026-08-21
  - The same final setup session observed the dedicated live Stripe account as `Verified`, with no
    warning banner, its receiving bank configured, and its production webhook enabled; the signed
    webhook probe then succeeded without counting a contribution
  - GoodAPI remained active at the disclosed `$49/month`, and its production key returned the exact
    approved St. Jude record in a search-only request without creating a donation
- [x] Require the checksum-pinned Gitleaks workflow and dependency checks to pass; enable GitHub's
  native secret scanning and push protection only if the private-repository account now offers them
  - A fresh `npm ci`, the full `npm audit`, and `npm audit --omit=dev` all report zero
    vulnerabilities. GitHub dependency alerts and automatic security updates are enabled, and the
    Dependabot alert list is empty
  - GitHub's API reports that native secret scanning is disabled, and the current account does not
    offer Secret Protection for this user-owned private repository. No visibility or billing change
    was made merely to obtain it
  - The workflow's exact Gitleaks 8.30.1 archive matched its pinned SHA-256 checksum. Its local
    full-history scan found no leaks, and GitHub Security run `32541642761` independently passed
    checkout, checksum verification, and the full-history scan for release commit `8d51bdd`

Exit: every production provider and public promise is configured and independently verified, but
the launch switch still prevents Checkout creation.

## Phase 7 — Controlled cutover

- [x] Run `npm test`, `npm run check`, and `npm run build`; require all to pass, commit and push every
  recognized launch change, require CI to pass, and verify Git is clean
  - From a fresh `npm ci`, all 45 tests, JavaScript syntax checking, the dotenv-isolated Wrangler
    dry run, the full dependency audit, and `git diff --check` passed. The locked bundle remains
    109.41 KiB compressed
  - Release commit `8d51bdd` is pushed to `origin/codex/outcharity-v1`; GitHub CI passed, and draft
    pull request `#1` targets `main` without enabling payments
- [x] Verify the immediate rollback: restore `OUTCHARITY_LAUNCH_APPROVED=false` and redeploy
  - From the clean committed tree, all 45 tests, syntax checking, the production dry build, and
    `git diff --check` passed with the launch flag explicitly false
  - Strict deployment created Worker version `b92a381c-4423-442c-a21b-46b7a7440cf3` with message
    `Locked rollback rehearsal; checkout remains disabled`; Cloudflare reports that version at
    100% of production traffic
  - `/health` returns `checkoutEnabled: false`, a production Checkout POST returns HTTP `503`, and a
    read-only D1 query reports zero advertisers, zero contributions, zero writes, and
    `changed_db: false`
- [x] Set `OUTCHARITY_LAUNCH_APPROVED=true`, deploy once, and verify `/health` reports
  `checkoutEnabled: true`
  - Kyle explicitly authorized the source-of-truth flag change, matching test and documentation
    updates, commit and push, and public live-Checkout deployment
  - The exact pre-deploy diff changed only the non-secret launch flag and its production assertion.
    The focused configuration suite passed 11/11; the full suite passed 45/45; syntax checking,
    generated binding validation, `git diff --check`, and the 109.41 KiB compressed dry build passed
    with the launch flag explicitly `true`
  - Strict deployment created Worker version `377d3711-45b5-407a-8471-a0e2479197cb` with message
    `Live Checkout enabled after explicit launch approval`; Cloudflare reports that version at 100%
    of production traffic
  - `/health` returns `checkoutEnabled: true`, the homepage exposes the live submission link, and
    `/submit` returns HTTP `200`. A post-deploy read-only D1 query reports zero advertisers, zero
    contributions, zero writes, and `changed_db: false`
- [ ] Open a live Checkout Session through the website and stop before supplying a payment method;
  this verifies the live Stripe key without violating Stripe's prohibition on fake live-mode tests
- [ ] Smoke-test the leaderboard, submission, management, success, legal, logo, sitemap, redirect,
  certificate, security-header, and mobile flows
- [ ] Begin public launch promotion only after every check above passes; do not manufacture a live
  purchase for testing
- [ ] Monitor the first genuine advertiser purchase through Stripe, the signed webhook, D1,
  GoodAPI, cache invalidation, and the public leaderboard
- [ ] Resend that genuine webhook once and verify the database and GoodAPI idempotency guarantees
  prevent duplicate financial records
- [ ] Watch Worker errors, Stripe webhook delivery, GoodAPI history, and D1 state closely through
  the first 24 hours; close checkout immediately if any money or charity record is ambiguous

Exit: Outcharity is accepting genuine purchases, the first transaction is reconciled end to end,
and the rollback remains tested and immediate.
