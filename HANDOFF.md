# Outcharity session handoff

This handoff is current through the commit that adds it. It becomes stale when `main` advances with product work or when any Phase 2 or Phase 3 item in `PLAN.md` changes.

## Exact stop point

- Outcharity is pre-launch. Phase 1 is implemented locally; checkout remains deliberately disabled by the launch gate.
- The lean-code refactor, correctness review, security audit, and test-suite audit are complete. No known code or test finding remains open.
- Version 1 is locked to a 90% charity allocation and a 10% platform allocation.
- The full suite has 41 tests. `npm test`, `npm run check`, and `npm run build` passed at wrapup.
- The checksum-pinned Gitleaks GitHub workflow passed after scanning full repository history.
- The repository is private at `kserrec/outcharity`. The local branch is `codex/outcharity-v1`, tracking `origin/main`; this pre-launch work is pushed directly to `main`, so no pull request is required.

## Next action

Send `GOODAPI_EMAIL.txt` to GoodAPI. That is the first incomplete item in Phase 2. Do not enable `OUTCHARITY_LAUNCH_APPROVED` or accept live payments before every Phase 2 approval item is complete.

## Pending external answers

- GoodAPI's standalone price and contractual compliance coverage
- Approved charity name, campaign wording, and disclosure
- Refund, chargeback, invoicing, and grant timing
- Test-mode and live-mode donation subscription activation

After those answers are recorded, continue Phase 3 in `PLAN.md`: create the production Cloudflare resources, configure encrypted secrets, apply the migration, configure Stripe webhooks, and run the real-payment launch checks.

## Resume checks

Read `README.md`, `PLAN.md`, and this file first. Before new work, run `npm test`, `npm run check`, and `npm run build`, then confirm the Git working tree is clean and synchronized with `origin/main`.
