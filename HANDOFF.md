# Outcharity session handoff

This handoff is current through the live Phase 7 Checkout Session probe on 2026-08-21. It becomes
stale when Phase 7 in `PLAN.md` progresses.

## Exact stop point

- Phase 6 is complete. Kyle confirmed receipt of the final `hello@outcharity.com` delivery test;
  the observed final Stripe status and the successful Stripe and GoodAPI production probes complete
  the provider gate without making Kyle repeat those checks.
- Kyle explicitly authorized the complete live-launch change boundary. Production Worker version
  `377d3711-45b5-407a-8471-a0e2479197cb` now receives 100% of traffic, and
  `https://outcharity.com/health` returns `{"ok":true,"checkoutEnabled":true}`.
- Kyle submitted the real public form and reached Stripe's live Checkout page, then stopped without
  supplying payment details. A subsequent read-only production D1 query returned zero advertisers,
  zero contributions, zero writes, and `changed_db: false`; no payment or charge occurred.
- Resume at the next unfinished Phase 7 item: smoke-test the leaderboard, submission, management,
  success, legal, logo, sitemap, redirect, certificate, security-header, and mobile flows.

## Completed external setup and rehearsal

- Cloudflare serves `outcharity.com`; production D1 `outcharity` and private R2
  `outcharity-logos` still exist. Email Routing for `hello@outcharity.com` is enabled and the
  destination was verified. Kyle sent the final launch-delivery message on 2026-08-21 and confirmed
  that it arrived at the configured destination inbox.
- GoodAPI Donations is active at the disclosed `$49/month`. A production-key search-only request
  returned `St Jude Childrens Research Hospital`, EIN `620646012`, nonprofit ID
  `n_6JeFQADP9Hq6qEAHcPqhsfEi`, and `WWW.STJUDE.ORG`. It called only `GET /charities/search`; no
  donation was created and no money moved. The configured official link is
  `https://www.stjude.org`.
- The dedicated live Stripe account says `Verified`, shows no red banner or business/payout
  warning, has its receiving bank configured, uses customer statement descriptor `OUTCHARITY`, and
  has two-factor authentication enabled. Separate support-contact fields do not exist in the
  observed current account interface. The optional paid Stripe Verified product was not enabled.
- The live parent-account Stripe webhook is enabled at
  `https://outcharity.com/webhooks/stripe` with snapshot API `2026-07-29.dahlia` and exactly the
  completed, asynchronous-payment-succeeded, and expired Checkout Session events.
- Because Stripe's observed current webhook-destination page offered no synthetic-event action, a
  temporary script outside the repository sent exactly one locally signed synthetic
  `checkout.session.completed` POST to the production endpoint. It returned HTTP `200` with
  `{"received":true,"counted":false}`. The script used a hidden terminal prompt, stored no secret,
  made no Stripe API request, and created no Checkout Session or payment.
- Cloudflare's encrypted Worker secret inventory contains exactly `GOODAPI_API_KEY`,
  `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`. The Stripe binding contains a restricted live
  key with Checkout Sessions write access only. No secret value entered the repository or chat.
- Phase 5 completed a real-provider sandbox rehearsal for `$10.00`: Stripe delivered two copies of
  the same signed webhook with HTTP `200`; D1 retained one contribution; allocation was exactly
  `$9.00` to St. Jude and `$1.00` to Outcharity; GoodAPI recorded one delivered test donation on
  one attempt; the listing ranked first and its logo returned `200 image/png`.
- All disposable rehearsal infrastructure is gone: the Stripe webhook, Cloudflare Worker
  `outcharity-rehearsal`, D1 `outcharity-rehearsal`, R2 `outcharity-rehearsal-logos`, and all
  `/tmp/outcharity-rehearsal-*` directories. No real payment or charitable funds moved.

## Diagnosed launch bug and local correction

- The first rehearsal form POST returned `403`. Live Worker evidence showed Chrome sent
  `Origin: null` because the form document used `Referrer-Policy: no-referrer`; the exact-origin
  guard then rejected it before Stripe, D1, R2, or GoodAPI work.
- The approved correction changes the policy to `same-origin` in `src/http.js` and
  `public/_headers`, and updates `test/security.test.js`. The origin guard itself is unchanged.
- Focused security tests passed 10/10 and the full suite passed 41/41 after the correction.
- The correction was deployed only with `OUTCHARITY_LAUNCH_APPROVED=false` in Worker version
  `d247957b-709e-4102-b446-fec279df64f6`. Production now returns
  `Referrer-Policy: same-origin`, while Checkout remains locked.

## Production campaign

- `wrangler.jsonc` now contains the approved non-secret campaign record:
  `St Jude Childrens Research Hospital`, EIN `620646012`, `https://www.stjude.org`, the generic
  `Buy the top spot. Help the featured charity.` headline, and the literal non-affiliation/90/10/
  processing-fee disclosure. The launch flag is now `true` following Kyle's authorized cutover.
- The approved refund and dispute policy is live on `/terms`. It promises full Stripe refunds to
  the original payment method when owed, keeps rank changes and policy-violating listings
  nonrefundable, makes Outcharity bear unrecoverable charity/provider costs, and does not imply
  that correcting a GoodAPI record reverses funds.
- The final Terms and Privacy pages were reverified after the current locked deployment. They
  publish the approved allocation, refund/dispute, listing, payment-data, provider-data, logging,
  and retention promises while saying that the Terms become effective when checkout opens.
- A read-only production D1 query after the signed webhook probe found zero advertisers and zero
  contributions. The post-homepage-deployment query found the same zero counts; Cloudflare's
  execution metadata reported `changes: 0`, `rows_written: 0`, and `changed_db: false`.

## Homepage hierarchy and current locked deployment

- `src/views.js` now renders a compact homepage header and campaign mast, a dominant #1 listing,
  a distinct #2/#3 podium group, and lower-ranked listings separately. Each real listing keeps an
  absolute full-card anchor to its submitted website with `target="_blank"` and
  `rel="noopener sponsored"`; the separate outbid link remains above that hit area.
- `public/styles.css` makes the top three the central visual hierarchy. At 390 and 320 CSS pixels,
  #1 and the side-by-side #2/#3 podium all fit in the first viewport. The empty production board
  instead shows `#1`, “The first confirmed listing owns the top spot,” and the explicit statement
  “No filler listings. No made-up activity.”
- Production status copy no longer incorrectly says campaign wording awaits approval. It now says
  checkout remains closed until every launch check passes, and the disabled control reads
  “Opening after final checks.” The launch gate behavior itself is unchanged.
- The homepage release was Worker version `5aea4953-5738-4a32-98fa-c2b9846527e5`, deployed with
  `OUTCHARITY_LAUNCH_APPROVED=false`. Its final pre-deploy gates passed 45/45 tests, JavaScript
  syntax checking, `git diff --check`, and Wrangler's 109.41 KiB compressed dry run; Worker startup
  was 6 ms.
- Live desktop and mobile screenshots match the locked design. The homepage returns `200`, health
  returns checkout disabled, and a direct Checkout POST returns `503`. Retained logs identify the
  current version with outcome `ok` and no exceptions for the homepage and health probes.
- No product data, dependency, payment, ranking, allocation, database, validation, or launch-gate
  behavior changed. Populated advertisers existed only in self-contained `/tmp` visual fixtures;
  no fixture row or asset entered production.

## Locked rollback rehearsal

- The clean committed tree again passed all 45 tests, JavaScript syntax checking, the diff check,
  and the 109.41 KiB compressed production dry build. The build listed
  `OUTCHARITY_LAUNCH_APPROVED` as `false`.
- A strict Wrangler deployment published Worker version `b92a381c-4423-442c-a21b-46b7a7440cf3`
  with message `Locked rollback rehearsal; checkout remains disabled`. Cloudflare reports that
  exact version at 100% of production traffic; startup remains 6 ms and no asset file changed.
- Live `/health` returns `{"ok":true,"checkoutEnabled":false}` and a same-origin production
  Checkout POST returns HTTP `503`. A subsequent read-only D1 query reports zero advertisers, zero
  contributions, zero changes, zero rows written, and `changed_db: false`.

## Live Checkout cutover

- Kyle explicitly authorized changing the version-controlled production flag, updating its exact
  test and launch documentation, committing and pushing the result, and opening genuine public
  Stripe Checkout.
- The exact pre-deploy executable diff changed only `OUTCHARITY_LAUNCH_APPROVED` from `false` to
  `true`; no application logic, campaign wording, allocation, secret, provider configuration, or
  database schema changed. The production assertion was updated to require the live value.
- The focused configuration suite passed 11/11 and the full suite passed 45/45. JavaScript syntax
  checking, generated Cloudflare binding validation, `git diff --check`, and the production dry
  build passed; the dry build was 109.41 KiB compressed and explicitly listed the launch flag as
  `true`.
- Strict deployment published Worker version `377d3711-45b5-407a-8471-a0e2479197cb` with message
  `Live Checkout enabled after explicit launch approval`. It receives 100% of production traffic,
  has 6 ms startup, and uploaded no changed asset file.
- Live `/health` returns `{"ok":true,"checkoutEnabled":true}`, the homepage renders its live
  `Get on the board` link, and `/submit` returns HTTP `200`. A subsequent read-only D1 query reports
  zero advertisers, zero contributions, zero changes, zero rows written, and `changed_db: false`.
- Kyle submitted the real public form and Stripe's live Checkout page opened. He entered no payment
  details and completed no payment. This verifies that the restricted live Stripe key can create
  the intended Checkout Session without making a prohibited fake live-mode purchase.
- The post-Session production D1 query still reports zero advertisers and zero contributions;
  Cloudflare reports `changes: 0`, `rows_written: 0`, and `changed_db: false`. Because fulfillment
  did not create a contribution, the application did not enter its GoodAPI-delivery path.
- The form uploaded a temporary logo before creating the Session. Its production deletion has not
  yet been observed; the signed `checkout.session.expired` handler is designed and covered by a
  focused test to delete an unused new-listing logo after Stripe expires the unpaid Session.

## Repository release gate

- Release commit `8d51bdd` contains every recognized locked-launch change and is pushed to
  `origin/codex/outcharity-v1`. Draft pull request `#1` targets `main` at
  `https://github.com/kserrec/outcharity/pull/1`; it has not been merged. Its source branch now
  includes live-cutover commit `4ba8856`, which enables payments in the deployed configuration.
- A fresh `npm ci` completed. All 45 tests, `npm run check`, `npm run build`, `npm audit`,
  `npm audit --omit=dev`, and `git diff --check` pass. Both dependency audits report zero
  vulnerabilities.
- `package.json` now makes the standard production build pass `/dev/null` as Wrangler's environment
  file. This prevents the release command from auto-loading a dotenv file and does not change the
  generated Worker.
- GitHub dependency alerts and automatic security updates are enabled, and the Dependabot alert
  list is empty. The repository is private and user-owned; the current account does not offer
  native secret scanning or push protection for that repository type, so neither could be enabled
  without changing repository visibility or account features.
- The checksum-pinned Gitleaks 8.30.1 archive matched SHA-256
  `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`. A local full-history scan
  found no leaks. GitHub Security run `32541642761` independently passed every step for release
  commit `8d51bdd`.
- `README.md` now describes the verified production resources, activated GoodAPI integration,
  enabled Cloudflare analytics, current locked bundle, safe build command, and exact continuation
  documents instead of the obsolete pre-production placeholders.

## Repository state

- Repository: `/home/serrecchia/Projects/outcharity`
- Branch: `codex/outcharity-v1`
- Locked application release commit: `8d51bdd Prepare locked production launch`
- Live cutover commit: `4ba8856 Enable live Outcharity checkout`
- Remote branch: `origin/codex/outcharity-v1`
- Draft pull request: `https://github.com/kserrec/outcharity/pull/1`
- The working tree is clean after this state update is committed.
- `wrangler.jsonc` sets production `OUTCHARITY_LAUNCH_APPROVED` true and contains only the approved
  non-secret production charity values. Never put provider secrets in that file.

## Resume sequence

1. Read this file and Phase 7 of `PLAN.md`.
2. Run the Phase 7 smoke tests for the leaderboard, submission, management, success, legal, logo,
   sitemap, redirect, certificate, security-header, and mobile flows.
3. Observe the unpaid Checkout Session's eventual Stripe expiration webhook and confirm that its
   temporary new-listing logo is removed without creating a financial record.
4. Do not begin public promotion or merge the draft pull request merely because Checkout is open.
