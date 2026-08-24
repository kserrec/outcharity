# Outcharity session handoff

This handoff is current through commit `54cd151` reaching `origin/main` on 2026-08-24. That commit
has **not** been deployed: Wrangler 4.125.0 reported that the saved Cloudflare OAuth token expired
and cannot be refreshed from Codex's non-interactive terminal. It becomes stale when Kyle completes
`npx wrangler login` in his own terminal, on the next production Worker deploy, or on private
reconciliation of the first confirmed public listing.

## Current pending deployment

- `main` and `origin/main` contain `54cd151` (`Harden public traffic and surface charity
  allocation`). It adds the high-contrast 90% charity banner, shared per-location checkout and
  public-data cost brakes, five-second query-independent `/stats` caching, homepage-plus-stats
  invalidation after money changes, and suppression of logs for invalid webhook signatures.
- All 87 tests pass, `npm run check` passes, `git diff --check` passes, and the build passes with
  `/dev/null` as Wrangler's environment file. The dry-run upload is 850.56 KiB raw and 121.69 KiB
  compressed.
- Production still runs the previously deployed source. The most recent verified production
  version recorded in `PLAN.md` is `6dd38ec9-37e9-4aa9-a81a-f171aed8a714`, with
  `ae4b56be-8208-4cab-b3a5-fe0a05819476` as its immediate rollback target; this session could not
  re-query Cloudflare after authentication expired.
- The next step is exactly one interactive action: from this repository, Kyle runs
  `npx wrangler login` in his own terminal and tells Codex when it succeeds. Codex then verifies
  `wrangler whoami`, deploys commit `54cd151` with `/dev/null` explicitly supplied as the environment
  file, checks the live health/homepage/stats/stylesheet behavior without creating a payment, and
  replaces this pending section with the deployed version and rollback evidence.

## Exact stop point

- The GitHub repository is public, its default branch is `main`, and release `v0.1.0` points to
  commit `1951c86`. The root `LICENSE` grants the standard MIT License, package metadata says
  `MIT`, and `package.json` remains private only to prevent accidental npm publication.
- The Gitleaks failure is fixed. Commit `c3920a2` allowlists 17 unique immutable fingerprints for
  inert Stripe-shaped test fixtures added in historical commit `d63d4cf`; it does not weaken any
  detection rule or exclude any source path. GitHub Security runs `32593742789` and `32594745669`
  pass, and native GitHub secret scanning plus push protection are enabled.
- Production runs Worker version `bcd1a77d-8d52-4843-ba85-70aaebdf5f31`, deployed from the source
  now recorded on `main`. It replaced version `f2dd830d-1dcf-4e5c-a666-b055e526bbd7`, which is the
  immediate rollback target. The deployment includes the current visual refresh, recent-activity strip,
  one-dollar minimum, campaign headline, one-row mobile leaderboard, public `/stats` work, permanent
  primary-navigation Stats link, and Cloudflare-backed visit total. Those runtime changes and their
  verification evidence are committed, so `origin/main` is the recovery source for the deployed
  version.
- Live `/health` returns `{"ok":true,"checkoutEnabled":true}`. The homepage now shows a confirmed
  four-entry leaderboard and links to Stats from the primary navigation, campaign panel, and footer.
  `/stats` returns six aggregate cards, its canonical URL is correct, the sitemap includes it, and
  the deployed mobile stylesheet gives each leaderboard entry and stats card its own row. Homepage
  totals and `/stats` now count only eligible payments from the four advertisers currently on the
  board: `$7` paid and `$6.30` allocated to charity. The hidden founder `$100` contribution no longer
  affects those public numbers; its matching Stripe event, D1 rows, charity hold state, and eventual
  GoodAPI record have not been privately reconciled.
- The sixth card reports 369 Website visits from the first successful Cloudflare Web Analytics sync
  at `2026-08-24T04:30:48.628Z`. This is an aggregate entry count rather than unique people or page
  views; bots are excluded, and European visits are absent because the existing automatic-injection
  setup does not collect them. D1 retains only daily counts and fetch timestamps.

## Release verification

- All 83 tests pass, `npm run check` passes, `git diff --check` passes, and `npm run build` passes
  while explicitly using `/dev/null` as Wrangler's environment file. The Worker upload is 837.79
  KiB raw and 119.03 KiB compressed, with a 5 ms startup time.
- Production D1 applied only `0004_web_analytics.sql`; both new tables were verified empty before
  deployment, and Wrangler then reported no pending migrations. Wrangler 4.125.0 deployed the
  Worker to the `outcharity.com` custom domain with no additional asset upload and retained the
  15-minute scheduled trigger.
- `npm audit` and `npm audit --omit=dev` both report zero vulnerabilities. GitHub Dependabot has
  zero open alerts and automatic security updates remain enabled.
- The checksum-pinned Gitleaks 8.30.1 archive matches SHA-256
  `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`; the exact CI command scans
  full Git history while explicitly excluding every dotenv pattern and reports no leak.
- Live read-only checks after this deployment pass for health, homepage, `/stats`, sitemap, and the
  deployed stylesheet. The live homepage reports `$7` paid and `$6.30` to charity; `/stats` reports
  those values plus four payments, four advertisers, a `$1.75` average, and 369 Website visits.
  Exact 320 px Chrome device emulation from the prior navigation deployment shows the wordmark plus
  Leaderboard, Stats, About, and Rules on one line with no horizontal overflow; the current deploy
  changed no asset.

## Production state that remains in force

- Checkout is open only because every launch-gate value is present and
  `OUTCHARITY_LAUNCH_APPROVED=true`. Production still requires a live Stripe key and rejects
  non-live webhook events.
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
- Generated `graphify-out/` data remains local and is ignored; it is not part of the repository.
- Public release: `https://github.com/kserrec/outcharity/releases/tag/v0.1.0`
- The old draft pull request is merged and is no longer the release path. New finished work goes to
  `main` unless a later documented workflow says otherwise.
- Wrangler OAuth is usable for `kserrec@gmail.com` on `Kserrec@gmail.com's Account`; the current
  deployment and post-deploy checks completed through that authenticated account.
