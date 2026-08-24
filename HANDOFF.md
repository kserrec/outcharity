# Outcharity session handoff

This handoff is current through the production deployment and read-only smoke test of runtime commit
`54cd151` on 2026-08-24. It becomes stale on the next runtime-affecting commit, production Worker
deploy, or private reconciliation of the first confirmed public listing.

## Current production deployment

- `main` and `origin/main` contain `54cd151` (`Harden public traffic and surface charity
  allocation`). It adds the high-contrast 90% charity banner, shared per-location checkout and
  public-data cost brakes, five-second query-independent `/stats` caching, homepage-plus-stats
  invalidation after money changes, and suppression of logs for invalid webhook signatures.
- All 87 tests pass, `npm run check` passes, `git diff --check` passes, and the build passes with
  `/dev/null` as Wrangler's environment file. The dry-run upload is 850.56 KiB raw and 121.69 KiB
  compressed.
- Worker version `13a426f0-6603-4345-bfda-25d0bd3477a4` receives 100% of production traffic. It
  replaced `5cb3f64a-461a-4938-badf-6d32d8e36afe`, which is the immediate rollback target. Wrangler
  4.125.0 uploaded the changed stylesheet, reported a 7 ms startup time, retained the custom domain
  and 15-minute schedule, and loaded no dotenv file because deployment explicitly used `/dev/null`.
- Live read-only checks return 200 for health, homepage, stylesheet, and stats. Checkout remains
  enabled; the banner precedes the metrics, navigation, and hero; it links to St. Jude; the detailed
  lower disclosure remains; desktop and mobile banner CSS is deployed; and homepage/stats responses
  carry the expected five-second cache policy, CSP, and HSTS. No payment or private record was
  created during verification.
- At the smoke test, public stats report `$7` paid, `$6.30` to charity, four payments, four visible
  advertisers, a `$1.75` average, and 444 Website visits. The delivery ledger partitions all
  `$96.30` of recorded charity shares into `$0` provider-accepted, `$96.30` awaiting provider, and
  `$0` stopped before delivery.

## Exact stop point

- The GitHub repository is public, its default branch is `main`, and release `v0.1.0` points to
  commit `1951c86`. The root `LICENSE` grants the standard MIT License, package metadata says
  `MIT`, and `package.json` remains private only to prevent accidental npm publication.
- The Gitleaks failure is fixed. Commit `c3920a2` allowlists 17 unique immutable fingerprints for
  inert Stripe-shaped test fixtures added in historical commit `d63d4cf`; it does not weaken any
  detection rule or exclude any source path. GitHub Security runs `32593742789` and `32594745669`
  pass, and native GitHub secret scanning plus push protection are enabled.
- Production runs Worker version `13a426f0-6603-4345-bfda-25d0bd3477a4`, deployed from runtime
  commit `54cd151` on `main`. It replaced version `5cb3f64a-461a-4938-badf-6d32d8e36afe`, which is
  the immediate rollback target. The deployment includes the prior launch work plus the 90% banner,
  shared cost brakes, stats caching/invalidation, and invalid-signature log suppression. The source
  and verification evidence are committed, so `origin/main` is the recovery source.
- Live `/health` returns `{"ok":true,"checkoutEnabled":true}`. The homepage now shows a confirmed
  four-entry leaderboard and links to Stats from the primary navigation, campaign panel, and footer.
  `/stats` returns six aggregate cards, its canonical URL is correct, the sitemap includes it, and
  the deployed mobile stylesheet gives each leaderboard entry and stats card its own row. Homepage
  totals and `/stats` now count only eligible payments from the four advertisers currently on the
  board: `$7` paid and `$6.30` allocated to charity. The hidden founder `$100` contribution no longer
  affects those public numbers; its matching Stripe event, D1 rows, charity hold state, and eventual
  GoodAPI record have not been privately reconciled.
- The sixth card reported 444 Website visits at the current smoke test. This is an aggregate entry
  count rather than unique people or page views; bots are excluded, and European visits are absent
  because the existing automatic-injection setup does not collect them. D1 retains only daily
  counts and fetch timestamps.

## Release verification

- All 87 tests pass, `npm run check` passes, `git diff --check` passes, and `npm run build` passes
  while explicitly using `/dev/null` as Wrangler's environment file. The Worker upload is 850.56
  KiB raw and 121.69 KiB compressed, with a 7 ms startup time.
- This deployment adds no migration. Wrangler 4.125.0 deployed the Worker to the `outcharity.com`
  custom domain, uploaded the changed stylesheet, and retained the 15-minute scheduled trigger.
- `npm audit` and `npm audit --omit=dev` both report zero vulnerabilities. GitHub Dependabot has
  zero open alerts and automatic security updates remain enabled.
- The checksum-pinned Gitleaks 8.30.1 archive matches SHA-256
  `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`; the exact CI command scans
  full Git history while explicitly excluding every dotenv pattern and reports no leak.
- Live read-only checks after this deployment pass for health, homepage, `/stats`, and the deployed
  stylesheet. The live homepage contains the correctly ordered 90% banner and lower disclosure;
  `/stats` reports `$7` paid, `$6.30` to charity, four payments, four advertisers, a `$1.75` average,
  and 444 Website visits. The current deploy changed only `styles.css` among static assets.

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
