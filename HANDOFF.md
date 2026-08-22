# Outcharity session handoff

This handoff is current through the locked Phase 6 production homepage deployment on 2026-08-21.
It becomes stale when Phase 6 in `PLAN.md` progresses or the tracked working changes below are
committed or replaced.

## Exact stop point

- Resume at the first unfinished Phase 6 item: reverify `hello@outcharity.com` delivery and the
  final Stripe and GoodAPI dashboard status.
- Production remains deliberately locked. `https://outcharity.com/health` most recently returned
  `{"ok":true,"checkoutEnabled":false}`, and a direct Checkout POST returned HTTP `503`. Do not
  enable it during Phase 6.

## Completed external setup and rehearsal

- Cloudflare serves `outcharity.com`; production D1 `outcharity` and private R2
  `outcharity-logos` still exist. Email Routing for `hello@outcharity.com` is enabled and the
  destination was verified.
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

## Locked production campaign

- `wrangler.jsonc` now contains the approved non-secret campaign record:
  `St Jude Childrens Research Hospital`, EIN `620646012`, `https://www.stjude.org`, the generic
  `Buy the top spot. Help the featured charity.` headline, and the literal non-affiliation/90/10/
  processing-fee disclosure. The launch flag remains `false`.
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
- The current production Worker version is `5aea4953-5738-4a32-98fa-c2b9846527e5`, deployed with
  `OUTCHARITY_LAUNCH_APPROVED=false`. The final pre-deploy gates passed 45/45 tests, JavaScript
  syntax checking, `git diff --check`, and Wrangler's 109.41 KiB compressed dry run; Worker startup
  is 6 ms.
- Live desktop and mobile screenshots match the locked design. The homepage returns `200`, health
  returns checkout disabled, and a direct Checkout POST returns `503`. Retained logs identify the
  current version with outcome `ok` and no exceptions for the homepage and health probes.
- No product data, dependency, payment, ranking, allocation, database, validation, or launch-gate
  behavior changed. Populated advertisers existed only in self-contained `/tmp` visual fixtures;
  no fixture row or asset entered production.

## Repository state

- Repository: `/home/serrecchia/Projects/outcharity`
- Branch: `codex/outcharity-v1`
- Last commit: `098242e Document wrapup stop point`
- Tracked working changes: `PLAN.md`, `HANDOFF.md`, `public/_headers`, `public/styles.css`,
  `src/http.js`, `src/views.js`, `test/config-and-views.test.js`, `test/security.test.js`, and
  `wrangler.jsonc`.
- No commit or push was performed during this session.
- `wrangler.jsonc` keeps production `OUTCHARITY_LAUNCH_APPROVED` false and now contains only the
  approved non-secret production charity values. Never put provider secrets in that file.

## Resume sequence

1. Read this file and Phase 6 of `PLAN.md`.
2. Finish the Phase 6 email, provider-dashboard, repository-host, and secret-scanning checks in
   plan order.
3. Do not accept a live payment or change the launch flag until the corresponding
   Phase 6 or Phase 7 gate explicitly authorizes it.
