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
- [x] Open a live Checkout Session through the website and stop before supplying a payment method;
  this verifies the live Stripe key without violating Stripe's prohibition on fake live-mode tests
  - Kyle submitted the real public form and Stripe's live Checkout page opened. He supplied no
    payment details, made no payment attempt, and incurred no charge
  - A subsequent read-only production D1 query returned zero advertisers and zero contributions;
    Cloudflare reported `changes: 0`, `rows_written: 0`, and `changed_db: false`. Fulfillment and
    GoodAPI delivery therefore did not begin
  - The uploaded logo remains temporary until Stripe expires the unpaid Session. The signed
    `checkout.session.expired` handler is designed and tested to delete that unused logo; its
    production delivery and deletion have not yet been observed
- [x] **Before deploying the audit fixes**, subscribe the production Stripe webhook endpoint to the
  two listing-suspension events added by the 2026-08-21 audit (Kyle, Stripe Dashboard). The
  updated Terms promise automatic hiding, so the subscription must exist before that text goes
  live. In Stripe → Developers → Webhooks → the
  `https://outcharity.com/webhooks/stripe` endpoint → "Update details" / "Select events", add
  `charge.dispute.created` and `charge.refunded`, then save. Done looks like: the endpoint's event
  list shows five events (the three Checkout Session events plus these two). Until this is done,
  a refund or dispute does not hide its listing automatically and must be hidden by hand
  - Done 2026-08-22: the Workbench endpoint row now lists 5 events
- [x] Deploy the 2026-08-21 audit fixes (`SECURITY.md` lists them): first confirm
  `npx wrangler d1 migrations list outcharity --remote` shows `0001_initial.sql` as already
  applied and only `0002_payment_suspensions.sql` pending, then run the new D1 migration
  `0002_payment_suspensions.sql` against production (`npx wrangler d1 migrations apply outcharity
  --remote`) before `npx wrangler deploy`, then confirm `/health` still reports
  `checkoutEnabled: true` (the live key passes the new live-mode-only rule). The deploy also
  ships the new `CHARITY_HOLD_DAYS=30` setting, the $100,000 cap, mandatory 3-D Secure at
  checkout, and the Terms that make payments final after thirty days. From then on the 15-minute
  task sends each charity share thirty days after its payment; check GoodAPI's dashboard a month
  after the first real purchase to confirm the first delivery.
  - Done 2026-08-22: `0002_payment_suspensions.sql` applied (`No migrations to apply`), Worker
    version `b4146d3f-1133-4827-ae64-ce9712e2dff9` at 100%, `/health` returns
    `{"ok":true,"checkoutEnabled":true}`, `/terms` serves the 30-day wording, HSTS/CSP present The deploy also turns off Cloudflare invocation logs, so the
  Workers Logs view afterwards shows only the Worker's own `console.error` lines
- Test audit, 2026-08-21: 34 product mutations run against the suite; every test that was mutated
  against caught its failure. Seven proven gaps (cross-origin form posts, cron wiring, homepage
  purge on a new payment, orphaned logo when Stripe fails, GoodAPI timeout, wrong-token cookie on
  the success page, mode guard) now have tests; a cold review strengthened four of them. Left as
  notes, not tests: webhook fulfillment failures could stop logging with no test noticing (no
  promise covers logging); `/success` compares `advertiser_id` to the contribution before the
  token-hash check, which already decides the outcome — redundant code for a refactor pass; the
  mobile-CSS regex test pins exact stylesheet text and will fail on innocent CSS edits (Kyle's
  call whether to narrow it)
- Bug hunt, 2026-08-21: five confirmed defects fixed with tests — a submission showed only the
  first invalid field, two parsers of `CHARITY_HOLD_DAYS` could disagree (Terms vs cron), the
  homepage totals counted refunded or disputed money as "confirmed giving"/"to charity", an
  outbid link could offer less than the minimum after the minimum is raised, and SECURITY.md
  wrongly said form posts require the management cookie. A cold review then found two more,
  also fixed: the suspension checks used `NOT IN` on a nullable column (a row with no payment
  intent could vanish from totals or never be delivered; now `NOT EXISTS` plus `NOT NULL` on
  `payment_suspensions`), and a zero-padded `CHARITY_HOLD_DAYS` such as `030` closed checkout
  despite parsing correctly. Settled as not a bug: the strict GoodAPI `amount_cents` comparison
  (the provider's OpenAPI spec declares an integer)
- [x] Kyle's ruling (2026-08-22): a listing's rank total counts only money that has not been
  refunded or disputed. Migration `0003_rank_totals_exclude_suspended.sql` recomputes
  `total_contributed_cents` on every confirmation and whenever a suspension is recorded or
  lifted; visibility after review remains a manual `is_hidden` update
- [x] Apply migration 0003 and deploy (same two commands as the hardening release), then confirm
  `/health` still reports `checkoutEnabled: true`
  - Done 2026-08-22: `No migrations to apply`; all five triggers present in production; Worker
    version `0530675f-0de1-4370-b604-a6a4130a2120` at 100%; `/health` ok
- [x] Publish Outcharity as an MIT-licensed open-source project from the default `main` branch
  - The public repository includes the standard MIT grant in `LICENSE`, matching `MIT` package
    metadata, contribution guidance in `README.md`, and private vulnerability-reporting directions
    in `SECURITY.md`
  - GitHub release `v0.1.0` points to commit `1951c86`; the release does not publish an npm package,
    and `package.json` remains `"private": true` to prevent accidental npm publication
  - GitHub native secret scanning and push protection are enabled now that the repository is public.
    Dependabot security updates remain enabled and the open Dependabot alert count is zero
- [x] Restore the full-history release security gate after the hardening commits
  - The failing Gitleaks 8.30.1 job reported 19 findings at commit `d63d4cf`, all in Stripe-shaped
    test fixtures. They reduced to 17 unique immutable fingerprints that were absent from
    `.gitleaksignore`; no application or deployment secret was found
  - Commit `c3920a2` adds only those 17 fixture fingerprints. The identical checksum-pinned local
    scan then passed, and GitHub Security runs `32593742789` and `32594745669` passed on `main`
- [x] Reconcile the open-source release with the production Worker and smoke-test public surfaces
  - From deployed source commit `55c739d` through release `v0.1.0`, `src/`, `public/`, `db/`, and
    `wrangler.jsonc` are unchanged. The only package changes are descriptive MIT/repository
    metadata, so Worker version `0530675f-0de1-4370-b604-a6a4130a2120` already contains the exact
    production code, assets, schema, and configuration; no no-op Worker version was created
  - A fresh `npm ci`, all 70 tests, syntax checking, the dotenv-isolated 115.34 KiB compressed dry
    build, `npm audit`, `npm audit --omit=dev`, `git diff --check`, and the full-history Gitleaks scan
    pass. Both dependency audits report zero vulnerabilities
  - Live read-only checks return `200` for the homepage, submission, Terms, Privacy, sitemap,
    robots, and the confirmed listing logo; `/health` returns checkout enabled; HTTP redirects to
    HTTPS; invalid management/logo paths return `404`; an invalid success link returns `400`; and
    the homepage and logo retain the expected CSP, HSTS, frame denial, and cache policies. Mobile
    hierarchy remains covered by the passing rendering and stylesheet tests
- [ ] Reconcile the first confirmed public listing through every private provider and datastore
  - On 2026-08-22 the public leaderboard showed `Outcharity` at #1 with `$100` given, and its PNG
    logo returned `200`. This proves the public confirmed-listing read path, but the corresponding
    Stripe event, D1 rows, scheduled hold state, and eventual GoodAPI record remain unverified
- [ ] Begin public launch promotion only after every check above passes; do not manufacture a live
  purchase for testing
- [ ] Resend that genuine webhook once and verify the database and GoodAPI idempotency guarantees
  prevent duplicate financial records
- [ ] Watch Worker errors, Stripe webhook delivery, GoodAPI history, and D1 state closely through
  the first 24 hours; close checkout immediately if any money or charity record is ambiguous

Exit: Outcharity is accepting genuine purchases, the first transaction is reconciled end to end,
and the rollback remains tested and immediate.

## Phase 8 — Public campaign stats

- [x] Add one D1 snapshot query for total paid, actual charity allocation, counted payments,
  visible advertisers on the board, and the average counted payment. Count only eligible payments
  belonging to advertisers currently visible on the board; add no migration.
  - `getPublicStats` derives all five values in one prepared D1 statement. Payment totals use the
    leaderboard's shared visibility and suspension exclusions; the visible-advertiser count remains
    intentionally distinct from the transaction count; the average rounds to the nearest cent and
    the empty state is exactly zero
- [x] Add a server-rendered public `/stats` page that defines each number plainly and exposes no
  individual transaction, payment identifier, visitor analytics, or historical chart.
  - The page states the refund/dispute rule, repeat-payment semantics, charity-favoring cent
    allocation, and average calculation beside the numbers. It reads only existing D1 records and
    introduces no browser-side analytics or package
- [x] Link the page from the homepage primary navigation, campaign-status area, and footer, include
  it in the public sitemap, and keep the five-stat layout readable as one full-width column on small
  screens.
  - The homepage primary navigation and campaign panel link to the page, every public footer includes
    Stats, `/stats` is canonical and shareable through the sitemap, and the 760 px breakpoint forces
    one card per row
- [x] Prove the aggregate semantics, zero state, rounding, route response, page copy, navigation,
  sitemap, and responsive CSS with focused tests, then run the full test, syntax, dry-build, and
  diff checks.
  - Focused database and page/route checks pass. All 78 tests, `npm run check`, the dotenv-isolated
    116.81 KiB compressed dry build, and `git diff --check` pass. No package, migration, new data
    store, or tracking surface was added
  - Wrangler verified that production D1 had no pending migration, then deployed Worker version
    `b894efa3-74d0-4eb3-b9d5-0685c8ab6516` to the `outcharity.com` custom domain. Exact 320 px Chrome
    device emulation proves all four primary links fit on one line without overflow; clicking Stats
    reaches the five-card page at the same width. Version `03b50de1-aa29-4649-8f81-c0f48fa14a15`
    was its immediate rollback target
- [x] Correct both homepage and `/stats` money aggregates so a hidden founder contribution cannot
  affect public numbers; public totals now mean exactly the eligible payments represented by current
  board advertisers.
  - The verified cause was an aggregate over all eligible contribution rows without a join to the
    visible advertiser set. The shared query now applies both rules, and regression coverage proves
    hidden advertisers, suspended payments, repeat visible payments, charity rounding, and the
    visible-board count together
  - All 78 tests, syntax checking, the dotenv-isolated 116.83 KiB compressed dry build, and
    `git diff --check` pass. No package, migration, data mutation, data store, or tracking surface was
    added
  - A read-only production query returned 700 cents paid, 630 cents allocated to charity, four
    payments, and four visible advertisers. Worker version
    `bfe635ff-3605-4e8f-a47e-5ef8f3a00ee2` is deployed; live homepage and `/stats` probes show `$7`,
    `$6.30`, `4` payments, `4` advertisers, and a `$1.75` average. Version
    `b894efa3-74d0-4eb3-b9d5-0685c8ab6516` is the immediate rollback target

Exit: Visitors can open one shareable stats page whose five numbers match the leaderboard's public
money rules, with no new dependency, data store, or tracking surface.

## Phase 9 — Public website visits

- [x] Define the public number as Cloudflare Web Analytics visits rather than viewers or page views:
  an entry from a direct link or another site, with bots excluded and European traffic absent under
  the already-approved non-EU collection rule. Preserve the verified launch floor of 368 without
  presenting it as a unique-person count.
- [x] Add daily aggregate storage and an hourly-guarded Cloudflare GraphQL sync to the existing
  15-minute scheduled event. Keep only the day, count, and fetch time; store no individual visit,
  IP address, browser detail, or tracking identifier. Isolate analytics failures from charity
  delivery and retain the last successful total.
- [x] Extend the existing one-statement D1 stats snapshot and server-rendered `/stats` page with a
  sixth Website visits card after the first successful sync. Add no runtime package, browser script,
  cookie, fingerprint, or new analytics collection mechanism.
- [x] Apply migration `0004_web_analytics.sql`, deploy the Worker, verify the first live GraphQL sync
  against the Cloudflare dashboard baseline, and prove the public card and existing payment stats in
  production.
- [x] Run the full test, syntax, dotenv-isolated dry-build, migration, secret-name, and diff checks;
  record the deployed version and immediate rollback target.
  - Production D1 applied only migration `0004_web_analytics.sql`; both new aggregate tables were
    empty before deployment and no migration remains pending. The first scheduled GraphQL query at
    `2026-08-24T04:30:48.628Z` stored four daily totals summing to 369, which is above and therefore
    consistent with the 368-visit dashboard screenshot taken earlier that evening
  - Live `/stats` shows 369 Website visits while preserving `$7` paid, `$6.30` to charity, four
    payments, four advertisers, and a `$1.75` average. `/health` remains healthy with checkout
    enabled, and the encrypted secret-name inventory includes `CLOUDFLARE_ANALYTICS_TOKEN` without
    exposing its value
  - All 83 tests, `npm run check`, the dotenv-isolated 119.03 KiB compressed dry build, and
    `git diff --check` pass. Worker version `bcd1a77d-8d52-4843-ba85-70aaebdf5f31` receives 100% of
    production traffic; version `f2dd830d-1dcf-4e5c-a666-b055e526bbd7` is the immediate rollback
    target. No asset changed during deployment

Exit: `/stats` publishes an automatically refreshed, bot-filtered aggregate website-visit total
without claiming unique viewers or retaining visitor-level data, while all existing money and
charity-delivery behavior remains intact.

## Phase 10 — More ways to help and charity-delivery transparency

- [x] Add a server-rendered public `/help` page for visitors who do not want to purchase a
  leaderboard listing.
  - It links to St. Jude's official donation form, GiveWell's current charity research and Top
    Charities Fund, IRS and FTC verification guidance, the American Red Cross blood-drive search,
    Feeding America's food-bank search, and Idealist's volunteer search
  - Every destination was opened and verified on 2026-08-24. The page uses plain destination URLs
    without affiliate or campaign query parameters, opens them with `noopener noreferrer`, and
    states that Outcharity neither processes nor observes the outside action
- [x] Make the alternative visible without turning it into a fifth primary-navigation item.
  - The homepage campaign panel now says “Not here to advertise? Help another way,” every public
    footer links to “Help more,” and `/help` is canonical and included in the sitemap
  - The four-link primary navigation remains unchanged and still fits the 320 px supported minimum
- [x] Extend the existing one-statement `/stats` snapshot with an exact delivery ledger and add no
  migration.
  - Every recorded charity share is partitioned into provider-accepted, awaiting-provider, or
    stopped-before-delivery amounts. Delivered shares remain historically accepted even if their
    listing is later hidden or payment later suspended; pending and failed shares move to stopped
    only when a refund or dispute prevents delivery
  - The page defines provider acceptance narrowly as GoodAPI returning a donation record and does
    not claim Outcharity independently observed the charity's bank receipt
- [x] Prove data partitioning, hidden and suspended history, zero state, page trust copy, exact
  destinations, external-link isolation, route behavior, sitemap discovery, and responsive layout.
  - All 85 tests, `npm run check`, the dotenv-isolated 121.46 KiB compressed dry build, and
    `git diff --check` pass
  - Local Chrome screenshots at 1440 px, 390 px, and 320 px show the homepage entry point, help
    cards, delivery ledger, footer, and unchanged primary navigation without horizontal overflow
  - No package, migration, data store, browser-side tracking, payment behavior, provider behavior,
    or production configuration was added or changed
  - Worker version `6dd38ec9-37e9-4aa9-a81a-f171aed8a714` receives 100% of production traffic;
    version `ae4b56be-8208-4cab-b3a5-fe0a05819476` is the immediate rollback target
  - Live `/`, `/help`, `/stats`, `/sitemap.xml`, and `/health` return 200. Checkout remains enabled;
    the homepage publishes `$7`, four advertisers, four payments, and 393 visits; and the delivery
    ledger partitions all `$96.30` of recorded charity shares into `$0` accepted, `$96.30` awaiting,
    and `$0` stopped
  - The live help page has its canonical URL, all eight verified plain destinations, the promised
    outside-action disclosure, and `no-store`, CSP, HSTS, referrer-policy, and frame-denial headers
- [x] Put the approved 90% charity-allocation promise in a high-contrast banner before the homepage
  metrics, navigation, and hero so it is visible without scrolling on desktop and mobile. Keep the
  lower detailed disclosure for the 10% platform share, payment-fee promise, and non-affiliation
  language.

Exit: Visitors have a trustworthy non-advertising path to direct giving, researched giving, and
non-monetary service, while the stats page publishes an exact aggregate record of what happened to
every charity share.

## Phase 11 — DDoS and denial-of-wallet hardening

- [x] Verify the live traffic path and distinguish Cloudflare's network-level DDoS mitigation from
  application-layer cost controls. Record that Workers Rate Limiting and the Cache API execute
  after a Worker invocation and operate independently in each Cloudflare location.
- [x] Put one shared checkout counter on both anonymous checkout paths after successful bot proof
  but before D1, R2, or Stripe work, while preserving their earlier per-client counters, body
  limits, validation, R2-before-Stripe consistency rule, payment allocation, webhook authority,
  and charity-delivery behavior.
- [x] Cache `/stats` for five seconds with one query-independent key, put homepage and stats D1
  cache misses behind one shared lookup counter, purge both public-data cache entries after a
  confirmed payment or listing suspension, and stop logging unsigned hostile webhook probes.
- [x] Extend that aggregate lookup counter to valid-looking success and management requests and
  uncached logos, so distributed clients cannot bypass the per-client limits to multiply D1 or R2
  reads.
- [x] Deploy this first server-side hardening chunk together with the homepage allocation banner,
  before the remaining Turnstile and account-control work.
  - All 87 tests, syntax checking, the dotenv-isolated 121.69 KiB compressed dry build, and diff
    checks pass. GitHub's secret-history scan passes for runtime commit `54cd151`
  - Worker version `13a426f0-6603-4345-bfda-25d0bd3477a4` receives 100% of production traffic;
    `5cb3f64a-461a-4938-badf-6d32d8e36afe` is the immediate rollback target
  - Live health, homepage, stylesheet, and stats checks pass without creating a payment. Checkout
    remains enabled; the banner and mobile styles are deployed; stats uses the five-second cache
    policy; and CSP and HSTS remain present
- [x] Create one managed Turnstile widget for `outcharity.com`, `localhost`, and `127.0.0.1`; verify
  a one-use token server-side on both checkout routes with separate expected actions, the expected
  hostname, the connecting IP, a 2,048-character token cap, and a ten-second verification timeout.
  Store the secret only in Cloudflare's encrypted Worker secret store and keep checkout closed if
  either Turnstile binding is missing outside local development.
- [x] Verify that the `outcharity.com` zone uses the Free Website plan and that Cloudflare's
  deployment API identifies the account as Workers Free. Record the platform's fixed
  10-millisecond per-invocation CPU ceiling and 100,000-request daily limit. Do not configure a
  custom CPU limit: Cloudflare rejects it before version creation on this plan.
- [x] Test, independently cold-review, deploy, and smoke-test the application hardening.
  - All 93 tests, syntax checking, diff checking, the dotenv-isolated 855.31 KiB raw / 122.89 KiB
    compressed dry build, and a fresh final security review pass
  - Worker version `948c2a32-d318-47de-bff3-8d16f727e0d9` receives 100% of production traffic;
    secret-change version `fcb9abe6-e201-469d-8d4b-31b9b258cf38` is the immediate rollback target
  - Live health reports checkout enabled; `/submit` contains the approved site key and
    `new_checkout` action; both checkout POST routes refuse a missing proof with 403; the Turnstile
    CSP and responsive stylesheet are live; homepage and stats retain five-second caching
- [x] Complete a browser-backed production check that one fresh real Turnstile token reaches
  application validation and that replaying the same token is refused, without creating a payment.
  - In a normal browser on the live `/submit` page, the managed widget produced a fresh token. An
    intentionally incomplete `POST /checkout` using that token returned 422 with the application's
    field-validation response, proving the browser-to-backend-to-Siteverify path accepted it.
  - Replaying the identical token immediately returned 403 with the application's human-verification
    rejection. Neither request reached logo storage, advertiser persistence, or Stripe checkout.
- [x] Use a narrowly scoped Zone WAF Edit token to inspect the Free plan's one pre-Worker
  rate-limit slot, preserve any existing rule, and add checkout protection without touching the
  Stripe webhook path.
  - No rate-limit entry point or conflicting custom/skip rule existed. Cloudflare accepted the
    exact payload in a non-persisting dry run, and an independent cold review approved it.
  - Ruleset `644fd39039ce4fc78adf89ce0e44d2ab`, rule
    `03a4768f4b5e4e41ad6919c6c8968d63`, blocks an IP after five requests in ten seconds to
    `/checkout` or `/manage/*/checkout`, for ten seconds. Free counts all methods and each
    Cloudflare location separately.
  - A same-connection production probe returned five application 404 responses followed by two
    Cloudflare error-1015/429 responses. After expiration, health returned 200 and missing
    Turnstile proof returned the expected application 403. Encoded checkout paths were normalized
    into the protected application routes.
- [x] Inspect Cloudflare's Billing > Billable Usage page and create a practical account-wide budget
  alert if one is not already present.
  - The dashboard showed Cloudflare's auto-created account-wide `$10` alert.
  - A second account-wide `$1` alert named `Outcharity early usage warning` now notifies Kyle's
    selected billing recipient. It is an informational warning after processed usage, not a hard
    spending cap, and the `$10` alert remains as a fallback.
- [x] After the live-token, Rulesets, and billing checks, record the exact final account state and
  revoke every temporary Cloudflare API credential used for setup.
  - The managed Turnstile widget remains active for the three approved domains and two checkout
    actions; its secret remains only in encrypted Worker secret storage.
  - The checkout-only WAF rate-limit rule and the account-wide `$1` and `$10` budget alerts remain
    active. Both local setup-token files were permanently deleted, and both temporary dashboard API
    tokens were revoked.

Exit: Network floods are handled at Cloudflare's edge, automated checkout abuse is challenged
before R2 or Stripe work, downstream paid resources have layered cost brakes, and account-level
limits and notifications reduce denial-of-wallet exposure without claiming an impossible absolute
guarantee against every charge.

## Phase 12 — “Give and Grow” brand and 95/5 allocation

- [x] Verify the exact starting state before editing: production configuration used “Buy Clout. Do
  good.”, new payments were hard-locked to 90% charity and 10% platform, the stylesheet used vivid
  orange and yellow accents with one sans-serif system stack, and the favicon and social preview
  repeated the orange palette.
- [x] Change the production headline and fallback to “Give and Grow.” and hard-lock every new
  Checkout Session to 95% charity and 5% platform, including Stripe metadata, cent allocation,
  stored contribution fields, and the amount later sent to GoodAPI.
- [x] Preserve every earlier open Checkout Session and existing immutable contribution row, and
  describe mixed totals literally: sessions created under the current allocation use 95/5, while
  earlier sessions and completed payments keep the allocation recorded when checkout began. Keep
  `GOODAPI_EMAIL.txt` and earlier completed phases unchanged as historical records of the original
  90/10 launch.
- [x] Replace the vivid orange system with warm ivory, muted terracotta, sand, blush, cocoa, and
  restrained green tokens; use a humanist sans-serif system stack for interface copy and a classic
  serif system stack for editorial headings; recolor the favicon and social preview without adding
  a font or runtime dependency.
- [x] Run the focused allocation/view tests, full test suite, syntax check, dry production build,
  diff check, palette contrast probe, and final source/diff audit.
  - Focused allocation and view coverage passes, including the test that an earlier 90/10 Checkout
    Session keeps its recorded split after the current configuration changes to 95/5.
  - All 94 tests, JavaScript syntax checking, diff checking, and the dotenv-isolated dry production
    build pass at 855.76 KiB raw / 123.00 KiB compressed.
  - Headless Chrome renders at 1440, 390, and 320 pixels preserve the hierarchy and show no visible
    horizontal overflow; the longer transition-safe allocation wording still fits at 320 pixels.
  - Every tested normal-size text/background pair meets WCAG AA contrast; the lowest measured ratio
    is 4.83:1 for deep-cocoa text on the terracotta action color.
  - The final social preview is 1200 × 630 and 33,639 bytes, smaller than the prior 39,564-byte PNG;
    its exact wording, aspect ratio, and warm three-color system were visually inspected.

Exit: The local release candidate makes the current 95/5 promise exact from Checkout through
delivery, preserves historical allocations truthfully, and presents the warmer visual identity at
all public brand surfaces. Production deployment remains a separate explicit action.
