# Outcharity launch plan

## Phase 1 — Local product

- [x] Minimal Worker application structure
- [x] Leaderboard, outbid links, listing form, management link, and success page
- [x] Stripe Checkout and authoritative webhook fulfillment
- [x] D1 contribution integrity and R2 logo storage
- [x] Five-second public caching and webhook cache invalidation
- [x] Mobile layout, legal pages, social preview, and security headers
- [x] Focused money, payment, ranking, validation, and signed-webhook tests

## Phase 2 — Charity approval

- [x] Prepare the exact GoodAPI request in `GOODAPI_EMAIL.txt`
- [ ] Send `GOODAPI_EMAIL.txt` to GoodAPI
- [ ] Receive standalone pricing and contractual compliance coverage
- [ ] Receive approved charity name, campaign wording, and disclosure
- [ ] Confirm refund, chargeback, invoicing, and grant timing
- [ ] Activate GoodAPI's required donation subscription in test and live modes

Payments stay disabled until every Phase 2 approval item is complete.

## Phase 3 — Production

- [ ] Create the Cloudflare D1 database and R2 bucket
- [ ] Store payment and provider credentials as Cloudflare secrets
- [ ] Apply the production database migration
- [ ] Subscribe the Stripe webhook to Checkout completed, asynchronous-payment-succeeded, and expired events
- [ ] Complete a real payment and duplicate-webhook test
- [ ] Verify the charity delivery record and public cache refresh
- [ ] Enable Cloudflare Web Analytics and confirm Worker error logs
- [ ] Confirm the configured `outcharity.com` custom domain, certificate, and Cloudflare Always Use HTTPS setting
- [ ] Enable GitHub native secret scanning and push protection if the private-repository feature becomes available; until then, require the checksum-pinned Gitleaks workflow to pass
