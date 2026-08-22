# Outcharity session handoff

This handoff is current through the public `v0.1.0` open-source release and repository-security
stabilization on 2026-08-22. It becomes stale on the next runtime-affecting `main` commit,
production Worker deploy, or private reconciliation of the first confirmed public listing.

## Exact stop point

- The GitHub repository is public, its default branch is `main`, and release `v0.1.0` points to
  commit `1951c86`. The root `LICENSE` grants the standard MIT License, package metadata says
  `MIT`, and `package.json` remains private only to prevent accidental npm publication.
- The Gitleaks failure is fixed. Commit `c3920a2` allowlists 17 unique immutable fingerprints for
  inert Stripe-shaped test fixtures added in historical commit `d63d4cf`; it does not weaken any
  detection rule or exclude any source path. GitHub Security runs `32593742789` and `32594745669`
  pass, and native GitHub secret scanning plus push protection are enabled.
- The most recently verified production Worker version remains
  `0530675f-0de1-4370-b604-a6a4130a2120`. From its source commit `55c739d` through `v0.1.0`, every
  runtime-affecting path (`src/`, `public/`, `db/`, and `wrangler.jsonc`) is unchanged. The newer
  changes are the MIT license, repository docs/metadata, and Gitleaks allowlist, so production
  already runs the exact current code, assets, schema, and configuration. No no-op Worker version
  was created.
- Live `/health` returns `{"ok":true,"checkoutEnabled":true}`. The homepage now shows a confirmed
  `Outcharity` listing at #1 with `$100` given, and its production PNG logo returns `200`. This is
  public evidence of the confirmed-listing read path only; the matching Stripe event, D1 rows,
  charity hold state, and eventual GoodAPI record have not been privately reconciled.

## Release verification

- A fresh `npm ci` completed. All 70 tests pass, `npm run check` passes, and `npm run build` passes
  while explicitly using `/dev/null` as Wrangler's environment file. The dry Worker upload is
  823.46 KiB raw and 115.34 KiB compressed.
- `npm audit` and `npm audit --omit=dev` both report zero vulnerabilities. GitHub Dependabot has
  zero open alerts and automatic security updates remain enabled.
- The checksum-pinned Gitleaks 8.30.1 archive matches SHA-256
  `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`; the exact CI command scans
  full Git history while explicitly excluding every dotenv pattern and reports no leak.
- `git diff --check` passes. Live read-only checks pass for the homepage, submission page, legal
  pages, sitemap, robots, HTTP-to-HTTPS redirect, security headers, invalid private-link responses,
  and the confirmed public logo. Responsive hierarchy remains covered by the passing tests.

## Production state that remains in force

- Checkout is open only because every launch-gate value is present and
  `OUTCHARITY_LAUNCH_APPROVED=true`. Production still requires a live Stripe key and rejects
  non-live webhook events.
- Confirmed contributions remain immutable. Refunds and disputes hide the listing, remove the
  affected payment from rank and public totals, and prevent charity delivery while suspended.
- Charity delivery remains held for 30 days and retried by the 15-minute scheduled task. A payment
  within the hold window sends nothing to GoodAPI after a recorded refund or dispute.
- Production D1 migrations 0001 through 0003 and all five recorded triggers were verified before
  Worker version `0530675f-0de1-4370-b604-a6a4130a2120` was deployed.
- The Stripe production webhook was previously verified with its five required event types, and
  the live GoodAPI charity configuration was previously verified. Provider secrets remain only in
  encrypted provider storage and never entered the repository or chat.

## Remaining Phase 7 work

1. Reconcile the public `$100` listing against Stripe, the signed webhook delivery, D1 advertiser
   and contribution rows, its 30-day hold status, cache invalidation, and GoodAPI's current state.
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
- Public release: `https://github.com/kserrec/outcharity/releases/tag/v0.1.0`
- The old draft pull request is merged and is no longer the release path. New finished work goes to
  `main` unless a later documented workflow says otherwise.
- A Wrangler device-login attempt timed out without authorization. Future runtime-affecting work
  needs a usable Cloudflare OAuth login or API token before deployment; this release did not need
  one because its production inputs are unchanged.
