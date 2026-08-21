import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contributionFromCheckoutSession,
  newAdvertiserMetadata,
} from '../src/payments.js';
import {
  createGoodApiDonation,
  createStripeClient,
  verifyStripeEvent,
} from '../src/providers.js';

const advertiserId = '11111111-1111-4111-8111-111111111111';
const config = {
  charityPercentage: 90,
  platformPercentage: 10,
  charityName: 'Example Charity',
  charityEin: '12-3456789',
};

function paidSession(overrides = {}) {
  const metadata = newAdvertiserMetadata(
    {
      advertiserId,
      amountCents: 1_001,
      slug: 'example-11111111',
      name: 'Example',
      description: 'A short description.',
      url: 'https://example.com/',
      logoKey: `logos/${advertiserId}.png`,
      xHandle: null,
      managementTokenHash: 'a'.repeat(64),
    },
    config,
  );

  return {
    id: 'cs_test_1234567890',
    mode: 'payment',
    payment_status: 'paid',
    currency: 'usd',
    amount_total: 1_001,
    payment_intent: 'pi_1234567890',
    metadata,
    ...overrides,
  };
}

test('a confirmed Checkout Session becomes an exact integer-cent contribution', () => {
  const contribution = contributionFromCheckoutSession(paidSession());
  assert.equal(contribution.grossCents, 1_001);
  assert.equal(contribution.charityCents, 901);
  assert.equal(contribution.platformCents, 100);
  assert.equal(contribution.advertiser.id, advertiserId);
});

test('an unpaid or amount-mismatched Checkout Session cannot become a contribution', () => {
  assert.throws(
    () => contributionFromCheckoutSession(paidSession({ payment_status: 'unpaid' })),
    /not a confirmed payment/,
  );
  assert.throws(
    () => contributionFromCheckoutSession(paidSession({ amount_total: 1_002 })),
    /does not match/,
  );
});

test('unrelated Stripe Checkout Sessions are ignored', () => {
  const session = paidSession();
  session.metadata = {};
  assert.equal(contributionFromCheckoutSession(session), null);
});

test('Stripe webhook verification accepts a valid signature and rejects a bad one', async () => {
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({ id: 'evt_test', object: 'event', type: 'test.event' });
  const stripe = createStripeClient('sk_test_placeholder');
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });

  const event = await verifyStripeEvent(stripe, payload, signature, secret);
  assert.equal(event.id, 'evt_test');
  await assert.rejects(() => verifyStripeEvent(stripe, payload, signature, 'wrong_secret'));
});

test('GoodAPI delivery sends charity cents with a stable idempotency key', async () => {
  let captured;
  const contribution = {
    id: 'contribution-1',
    charity_amount_cents: 901,
    charity_ein: '12-3456789',
    charity_name: 'Example Charity',
    stripe_checkout_session_id: 'cs_test_1234567890',
  };
  const fetcher = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return new Response(
      JSON.stringify({ donation_id: 'donation-1', amount_cents: 901 }),
      { status: 200 },
    );
  };

  const result = await createGoodApiDonation(contribution, 'test-api-key', fetcher);
  assert.equal(result.donation_id, 'donation-1');
  assert.equal(captured.options.headers.Authorization, 'test-api-key');
  assert.equal(captured.body.amount_cents, 901);
  assert.equal(captured.body.idempotency_key, 'outcharity-cs_test_1234567890');
});
