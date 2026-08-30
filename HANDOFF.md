# Outcharity session handoff

This handoff is current through the logo-matched favicon production deployment of Worker version
`3ebc3e8f-af49-4513-a201-57044a6c7ba1` on 2026-08-30, including the earlier edge-rule, billing,
Turnstile, statistics, and search hardening. It becomes stale on the next runtime-affecting commit,
production Worker deploy, or private reconciliation of the first confirmed public listing.

## Current production deployment

- `main` is the release branch and tracks `origin/main`. Asset source commit `778efd3` contains the
  logo-matched favicon and repository-only demo MP4, and the current branch also contains its
  palette-optimized GIF derivative. Only the favicon is a deployed public asset;
  `demo/outcharity-demo.mp4` and `demo/outcharity-demo.gif` are not under `public/` and are not
  published.
- The deployed application requires a managed Turnstile proof on both checkout routes, verifies it
  server-side before D1, R2, or Stripe work, keeps an earlier per-client limiter, and consumes the
  shared checkout brake only after successful proof. Public cache misses and valid-looking private
  reads share a separate aggregate lookup brake.
- All 99 tests pass, `node --check src/index.js` passes, `git diff --check` passes, and the Wrangler
  4.125.0 build passes with `/dev/null` as its environment file. The upload is 863.67 KiB raw and
  124.87 KiB compressed; the deployed Worker reports a 12 ms startup time.
- Worker version `3ebc3e8f-af49-4513-a201-57044a6c7ba1` receives 100% of production traffic.
  Preceding SEO version `6196cc70-f1ed-4f00-ada6-1986bdc89d76` is the immediate rollback target.
  Wrangler retained the custom domain and 15-minute schedule and loaded no dotenv file.
- Live `/`, `/submit`, `/health`, and `/favicon.svg` return 200. Health reports checkout enabled,
  and the live favicon exactly matches the committed SHA-256
  `82dda134fb7386db80d03f0d71dbebff321cb74d2a56104e5938bcb6fbc5a1f2`. `/submit` contains the
  approved public site key, Turnstile script, and `new_checkout` action. Both checkout POST routes
  return 403 when proof is missing; the required script/frame CSP and responsive widget CSS are
  live; homepage and `/stats` retain their five-second cache policy. These probes created no
  payment or private record.
- A normal browser produced a fresh production token on `/submit`. An intentionally incomplete
  checkout request using it returned application validation status 422, while immediately replaying
  that identical token returned the application's Turnstile rejection status 403. This proves the
  live browser-to-backend-to-Siteverify path and single-use enforcement without creating a payment,
  logo, or advertiser record.
- Cloudflare identifies the account as Workers Free: the platform enforces 10 ms CPU per request
  and 100,000 Worker requests per day, and rejected a custom CPU limit before creating a version.
  D1 Free limits fail instead of billing overages. R2 can still incur usage charges after its
  monthly free tier. The zone's sole Free-plan rate-limit slot now protects both checkout paths;
  Billing > Billable Usage has an account-wide `$1` early warning and the auto-created `$10`
  fallback. These alerts are delayed informational warnings, not hard spending caps.
- Zone Rulesets started with no rate-limit entry point or conflicting custom/skip rule. Active
  ruleset `644fd39039ce4fc78adf89ce0e44d2ab`, rule
  `03a4768f4b5e4e41ad6919c6c8968d63`, blocks an IP after five requests in ten seconds to
  `/checkout` or `/manage/*/checkout`, for ten seconds. The Stripe webhook and all other paths are
  excluded. Cloudflare dry-run validation, independent cold review, API readback, encoded-path
  probes, five application 404s followed by two edge error-1015/429 blocks, and post-expiration
  health 200 / missing-proof 403 all passed.

## Exact stop point

- The GitHub repository is public, its default branch is `main`, and release `v0.1.0` points to
  commit `1951c86`. The root `LICENSE` grants the standard MIT License, package metadata says
  `MIT`, and `package.json` remains private only to prevent accidental npm publication.
- The Gitleaks failure is fixed. Commit `c3920a2` allowlists 17 unique immutable fingerprints for
  inert Stripe-shaped test fixtures added in historical commit `d63d4cf`; it does not weaken any
  detection rule or exclude any source path. GitHub Security runs `32593742789` and `32594745669`
  pass, and native GitHub secret scanning plus push protection are enabled.
- Production runs Worker version `3ebc3e8f-af49-4513-a201-57044a6c7ba1`. It replaced SEO version
  `6196cc70-f1ed-4f00-ada6-1986bdc89d76`, which is the immediate rollback target. Asset source
  commit `778efd3` and its later GIF derivative are on `origin/main`; the deployment-evidence
  commit is documentation-only.
- Live `/health` returns `{"ok":true,"checkoutEnabled":true}`. Missing proof on both checkout
  routes returns 403 before downstream work. A fresh real-browser proof reaches application
  validation with 422, and immediate replay of that proof is rejected with 403. The homepage now
  shows a confirmed
  four-entry leaderboard and links to Stats from the primary navigation, campaign panel, and footer.
  `/stats` returns six aggregate cards, its canonical URL is correct, the sitemap includes it, and
  the deployed mobile stylesheet gives each leaderboard entry and stats card its own row. Homepage
  totals and `/stats` now count only eligible payments from the four advertisers currently on the
  board: `$7` paid and `$6.30` allocated to charity. The hidden founder `$100` contribution no longer
  affects those public numbers; its matching Stripe event, D1 rows, charity hold state, and eventual
  GoodAPI record have not been privately reconciled.
- The sixth card reported 444 Website visits at the preceding `54cd151` smoke test. This is an
  aggregate entry count rather than unique people or page views; bots are excluded, and European
  visits are absent because the existing automatic-injection setup does not collect them. D1
  retains only daily counts and fetch timestamps.

## Release verification

- All 99 tests pass, `node --check src/index.js` passes, `git diff --check` passes, and the Wrangler
  4.125.0 dry build passes while explicitly using `/dev/null` as its environment file. The Worker
  upload is 863.67 KiB raw and 124.87 KiB compressed, with a 12 ms startup time.
- This deployment adds no migration. Wrangler deployed the Worker to the `outcharity.com` custom
  domain and retained the 15-minute scheduled trigger. Version inspection shows all five encrypted
  secret binding names, including `TURNSTILE_SECRET`, without exposing their values.
- `npm audit` and `npm audit --omit=dev` both report zero vulnerabilities. GitHub Dependabot has
  zero open alerts and automatic security updates remain enabled.
- The checksum-pinned Gitleaks 8.30.1 archive matches SHA-256
  `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`; the exact CI command scans
  full Git history while explicitly excluding every dotenv pattern and reports no leak.
- Current asset-release live checks pass for health, homepage, `/submit`, and the deployed favicon;
  the favicon bytes exactly match source, and both demo formats remain repository-only. The
  preceding safe missing-proof POST probes returned 403, and the public/private CSP variants both
  allow Turnstile while private pages continue to exclude analytics.
- Live zone checks prove URL-encoded checkout paths reach the same protected application routes.
  The active WAF rule permits five matching requests from one IP in ten seconds and stops the next
  two at Cloudflare with HTTP 429 before Worker execution; normal responses resume after the
  ten-second mitigation period.
- Cloudflare Billing > Billable Usage shows its auto-created account-wide `$10` alert. Kyle also
  created an account-wide `$1` alert named `Outcharity early usage warning` with his selected email
  recipient. Both are informational warnings after processed usage, not hard spending caps.
- The local temporary Turnstile and WAF token files were permanently deleted, and both dashboard
  tokens were revoked after their respective live verification. Neither token belongs in the
  repository.

## Production state that remains in force

- Checkout is open only because every launch-gate value is present and
  `OUTCHARITY_LAUNCH_APPROVED=true`. Production still requires a live Stripe key and rejects
  non-live webhook events. Checkout also closes if the Turnstile public key, encrypted secret,
  exact hostname, or either rate-limit binding is absent.
- Confirmed contributions remain immutable. Refunds and disputes hide the listing, remove the
  affected payment from rank and public totals, and prevent charity delivery while suspended.
  Payments belonging to any otherwise hidden listing are also absent from homepage and `/stats`
  aggregates, so public money totals match the advertisers currently represented on the board.
- Charity delivery remains held for 30 days and retried by the 15-minute scheduled task. A payment
  within the hold window sends nothing to GoodAPI after a recorded refund or dispute.
- Production D1 migrations 0001 through 0004 and all five existing triggers remain in force;
  migration 0004 adds only the daily visit-total and sync-state tables.
- The Stripe production webhook was previously verified with its five required event types, and
  the live GoodAPI charity configuration was previously verified. Provider secrets remain only in
  encrypted provider storage and never entered the repository or chat.
- `CLOUDFLARE_ANALYTICS_TOKEN` is stored only as an encrypted Worker secret with read-only Account
  Analytics permission. Its value never entered the repository or chat. An analytics failure is
  logged without interrupting the charity-delivery task or replacing the last successful count.

## Remaining Phase 7 work

1. Reconcile the existing founder `$100` contribution against Stripe, the signed webhook delivery,
   D1 advertiser and contribution rows, its 30-day hold status, cache invalidation, and GoodAPI's
   current state. Its listing is hidden and its money is excluded from all public aggregates.
2. Resend that genuine Stripe webhook once and verify D1 and GoodAPI idempotency prevent duplicate
   financial records.
3. Observe the earlier unpaid Checkout Session's expiration webhook and confirm its temporary logo
   was removed without creating a contribution.
4. Watch Worker errors, Stripe delivery, GoodAPI history, and D1 state through the first 24 hours;
   close checkout immediately if any money or charity record is ambiguous.
5. Begin promotion only after those private checks are complete. Never manufacture a live payment
   for testing.

## Repository state

- Repository: `/home/serrecchia/Projects/outcharity`
- Branch and upstream: `main` tracking `origin/main`
- The deployed Phase 16 favicon source and its verification evidence are committed and pushed to
  `origin/main`; the demo MP4 and GIF are committed there but are not deployed.
- Generated `graphify-out/` data remains local and is ignored; it is not part of the repository.
- Public release: `https://github.com/kserrec/outcharity/releases/tag/v0.1.0`
- The old draft pull request is merged and is no longer the release path. New finished work goes to
  `main` unless a later documented workflow says otherwise.
- Wrangler OAuth is usable for `kserrec@gmail.com` on `Kserrec@gmail.com's Account`; the current
  deployment and post-deploy checks completed through that authenticated account.
