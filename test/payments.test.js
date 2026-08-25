import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contributionFromCheckoutSession,
  existingAdvertiserMetadata,
  newAdvertiserMetadata,
} from '../src/payments.js';
import {
  createCheckoutSession,
  createGoodApiDonation,
  createStripeClient,
  verifyStripeEvent,
  verifyTurnstileToken,
} from '../src/providers.js';

const advertiserId = '11111111-1111-4111-8111-111111111111';
const config = {
  charityPercentage: 95,
  platformPercentage: 5,
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
  assert.equal(contribution.charityCents, 951);
  assert.equal(contribution.platformCents, 50);
  assert.equal(contribution.charityName, 'Example Charity');
  assert.equal(contribution.charityEin, '12-3456789');
  assert.equal(contribution.stripeCheckoutSessionId, 'cs_test_1234567890');
  assert.equal(contribution.stripePaymentIntentId, 'pi_1234567890');
  assert.equal(contribution.advertiser.id, advertiserId);
});

test('a Checkout Session created under the former split keeps its recorded allocation', () => {
  const session = paidSession();
  session.metadata = {
    ...session.metadata,
    charity_percentage: '90',
    platform_percentage: '10',
  };

  const contribution = contributionFromCheckoutSession(session);
  assert.equal(contribution.charityCents, 901);
  assert.equal(contribution.platformCents, 100);
  assert.equal(contribution.charityPercentage, 90);
  assert.equal(contribution.platformPercentage, 10);
});

test('an existing advertiser Checkout Session remains a cumulative contribution', () => {
  const metadata = existingAdvertiserMetadata(
    { advertiserId, amountCents: 2_500 },
    config,
  );
  const contribution = contributionFromCheckoutSession(
    paidSession({
      id: 'cs_test_existing_12345678',
      amount_total: 2_500,
      payment_intent: 'pi_existing_12345678',
      metadata,
    }),
  );

  assert.equal(contribution.advertiserId, advertiserId);
  assert.equal(contribution.advertiser, null);
  assert.equal(contribution.grossCents, 2_500);
  assert.equal(contribution.charityCents, 2_375);
  assert.equal(contribution.platformCents, 125);
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

test('Stripe Checkout charges the exact requested cents and preserves fulfillment data', async () => {
  let captured;
  const stripe = {
    checkout: {
      sessions: {
        async create(input) {
          captured = input;
          return { id: 'cs_test_created', url: 'https://checkout.stripe.com/test' };
        },
      },
    },
  };
  const metadata = { outcharity: 'v1', kind: 'existing' };
  const input = {
    advertiserId,
    amountCents: 1_001,
    charityName: 'Example Charity',
    charityPercentage: 95,
    successUrl: 'https://outcharity.com/success?session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'https://outcharity.com/manage/token',
    metadata,
  };

  const session = await createCheckoutSession(stripe, input);

  assert.equal(session.url, 'https://checkout.stripe.com/test');
  assert.equal(captured.mode, 'payment');
  assert.equal(captured.client_reference_id, advertiserId);
  assert.equal(captured.success_url, input.successUrl);
  assert.equal(captured.cancel_url, input.cancelUrl);
  assert.equal(captured.line_items[0].quantity, 1);
  assert.equal(captured.line_items[0].price_data.currency, 'usd');
  assert.equal(captured.line_items[0].price_data.unit_amount, 1_001);
  assert.deepEqual(captured.metadata, metadata);
  assert.equal(captured.payment_intent_data.metadata.advertiser_id, advertiserId);
  assert.match(captured.custom_text.submit.message, /Rankings may change/);
  assert.equal(captured.payment_method_options.card.request_three_d_secure, 'any');
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

test('Turnstile verification sends a bounded backend request and checks action and hostname', async (context) => {
  const timeoutSignal = new AbortController().signal;
  const timeouts = [];
  context.mock.method(AbortSignal, 'timeout', (milliseconds) => {
    timeouts.push(milliseconds);
    return timeoutSignal;
  });
  let captured;
  const verified = await verifyTurnstileToken(
    {
      token: 'turnstile-token',
      secret: 'turnstile-secret',
      remoteIp: '203.0.113.9',
      expectedAction: 'new_checkout',
      expectedHostnames: ['outcharity.com'],
    },
    async (url, options) => {
      captured = { url, options };
      return Response.json({
        success: true,
        action: 'new_checkout',
        hostname: 'outcharity.com',
      });
    },
  );

  assert.equal(verified, true);
  assert.equal(captured.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(captured.options.method, 'POST');
  assert.equal(
    captured.options.headers['Content-Type'],
    'application/x-www-form-urlencoded',
  );
  assert.equal(captured.options.body.get('secret'), 'turnstile-secret');
  assert.equal(captured.options.body.get('response'), 'turnstile-token');
  assert.equal(captured.options.body.get('remoteip'), '203.0.113.9');
  assert.equal(captured.options.signal, timeoutSignal);
  assert.deepEqual(timeouts, [10_000]);

  for (const result of [
    { success: false, action: 'new_checkout', hostname: 'outcharity.com' },
    { success: true, action: 'existing_checkout', hostname: 'outcharity.com' },
    { success: true, action: 'new_checkout', hostname: 'localhost' },
  ]) {
    assert.equal(
      await verifyTurnstileToken(
        {
          token: 'turnstile-token',
          secret: 'turnstile-secret',
          expectedAction: 'new_checkout',
          expectedHostnames: ['outcharity.com'],
        },
        async () => Response.json(result),
      ),
      false,
      JSON.stringify(result),
    );
  }
});

test('Turnstile verification fails closed on invalid input and upstream failures', async () => {
  let fetchCalls = 0;
  const input = {
    secret: 'turnstile-secret',
    expectedAction: 'new_checkout',
    expectedHostnames: ['outcharity.com'],
  };
  const unusedFetcher = async () => {
    fetchCalls += 1;
    return Response.json({ success: true });
  };

  for (const token of ['', 'x'.repeat(2_049), 'contains whitespace']) {
    assert.equal(await verifyTurnstileToken({ ...input, token }, unusedFetcher), false);
  }
  assert.equal(fetchCalls, 0);

  for (const fetcher of [
    async () => new Response('', { status: 503 }),
    async () => new Response('not json'),
    async () => {
      throw new Error('network unavailable');
    },
  ]) {
    assert.equal(
      await verifyTurnstileToken({ ...input, token: 'turnstile-token' }, fetcher),
      false,
    );
  }
});

test('GoodAPI sends exact charity cents and rejects a mismatched confirmation', async (context) => {
  const timeouts = [];
  const timeoutSignal = new AbortController().signal;
  context.mock.method(AbortSignal, 'timeout', (milliseconds) => {
    timeouts.push(milliseconds);
    return timeoutSignal;
  });
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
  assert.equal(captured.body.ein, '12-3456789');
  assert.equal(captured.body.charity_name, 'Example Charity');
  assert.equal(captured.body.idempotency_key, 'outcharity-cs_test_1234567890');
  assert.deepEqual(timeouts, [10_000], 'the provider call carries a 10-second timeout');
  assert.equal(captured.options.signal, timeoutSignal);

  await assert.rejects(
    () =>
      createGoodApiDonation(contribution, 'test-api-key', async () =>
        new Response(
          JSON.stringify({ donation_id: 'donation-wrong-amount', amount_cents: 900 }),
          { status: 200 },
        )),
    /incomplete or mismatched donation record/,
  );
});

test('the Stripe client has a bounded request timeout', () => {
  const stripe = createStripeClient('sk_test_placeholder');
  assert.equal(stripe.getApiField('timeout'), 20_000);
});
