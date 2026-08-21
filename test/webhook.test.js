import assert from 'node:assert/strict';
import test from 'node:test';

import { app } from '../src/index.js';
import { newAdvertiserMetadata } from '../src/payments.js';
import { createStripeClient } from '../src/providers.js';
import { TestD1Database } from './helpers/d1.js';

const advertiserId = '77777777-7777-4777-8777-777777777777';
const webhookSecret = 'whsec_webhook_test';
const stripe = createStripeClient('sk_test_placeholder');

function session(paymentStatus = 'paid') {
  const allocation = {
    charityPercentage: 90,
    platformPercentage: 10,
    charityName: 'Example Charity',
    charityEin: '12-3456789',
  };
  return {
    id: paymentStatus === 'paid' ? 'cs_test_webhook_paid' : 'cs_test_webhook_failed',
    object: 'checkout.session',
    mode: 'payment',
    payment_status: paymentStatus,
    currency: 'usd',
    amount_total: 1_000,
    payment_intent: paymentStatus === 'paid' ? 'pi_webhook_paid' : 'pi_webhook_failed',
    metadata: newAdvertiserMetadata(
      {
        advertiserId,
        amountCents: 1_000,
        slug: 'webhook-77777777',
        name: 'Webhook Company',
        description: 'A webhook integration test.',
        url: 'https://example.com/',
        logoKey: `logos/${advertiserId}.png`,
        xHandle: null,
        managementTokenHash: 'b'.repeat(64),
      },
      allocation,
    ),
  };
}

function signedRequestBody(checkoutSession, eventId, eventType = 'checkout.session.completed') {
  const payload = JSON.stringify({
    id: eventId,
    object: 'event',
    type: eventType,
    data: { object: checkoutSession },
  });
  return {
    payload,
    signature: stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    }),
  };
}

test('the signed webhook counts a paid session once and an unpaid session zero times', async (context) => {
  const db = new TestD1Database();
  const originalFetch = globalThis.fetch;
  let donationCalls = 0;
  globalThis.fetch = async (_url, options) => {
    donationCalls += 1;
    const request = JSON.parse(options.body);
    return new Response(
      JSON.stringify({ donation_id: 'goodapi-webhook-test', amount_cents: request.amount_cents }),
      { status: 200 },
    );
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
    db.close();
  });

  const env = {
    DB: db,
    STRIPE_SECRET_KEY: 'sk_test_placeholder',
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    GOODAPI_API_KEY: 'goodapi-test-key',
  };
  const paid = signedRequestBody(session('paid'), 'evt_paid');
  const firstResponse = await app.request(
    'http://localhost/webhooks/stripe',
    {
      method: 'POST',
      headers: { 'stripe-signature': paid.signature },
      body: paid.payload,
    },
    env,
  );
  const duplicateResponse = await app.request(
    'http://localhost/webhooks/stripe',
    {
      method: 'POST',
      headers: { 'stripe-signature': paid.signature },
      body: paid.payload,
    },
    env,
  );

  const unpaid = signedRequestBody(session('unpaid'), 'evt_unpaid');
  const unpaidResponse = await app.request(
    'http://localhost/webhooks/stripe',
    {
      method: 'POST',
      headers: { 'stripe-signature': unpaid.signature },
      body: unpaid.payload,
    },
    env,
  );

  assert.equal(firstResponse.status, 200);
  assert.deepEqual(await firstResponse.json(), { received: true, counted: true });
  assert.equal(duplicateResponse.status, 200);
  assert.deepEqual(await duplicateResponse.json(), { received: true, counted: false });
  assert.equal(unpaidResponse.status, 200);
  assert.deepEqual(await unpaidResponse.json(), { received: true, counted: false });

  const count = await db.prepare('SELECT COUNT(*) AS count FROM contributions').first();
  const contribution = await db
    .prepare(
      `SELECT charity_amount_cents, platform_amount_cents, charity_percentage, platform_percentage
       FROM contributions`,
    )
    .first();
  const advertiser = await db
    .prepare('SELECT total_contributed_cents FROM advertisers WHERE id = ?')
    .bind(advertiserId)
    .first();
  assert.equal(count.count, 1);
  assert.deepEqual({ ...contribution }, {
    charity_amount_cents: 900,
    platform_amount_cents: 100,
    charity_percentage: 90,
    platform_percentage: 10,
  });
  assert.equal(advertiser.total_contributed_cents, 1_000);
  assert.equal(donationCalls, 1);
});

test('an expired new-listing session deletes only its own uploaded logo', async () => {
  const deletedKeys = [];
  const env = {
    STRIPE_SECRET_KEY: 'sk_test_placeholder',
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    LOGOS: {
      async delete(key) {
        deletedKeys.push(key);
      },
    },
  };
  const expiredSession = session('unpaid');
  const expired = signedRequestBody(
    expiredSession,
    'evt_expired',
    'checkout.session.expired',
  );
  const response = await app.request(
    'http://localhost/webhooks/stripe',
    {
      method: 'POST',
      headers: { 'stripe-signature': expired.signature },
      body: expired.payload,
    },
    env,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, counted: false });
  assert.deepEqual(deletedKeys, [`logos/${advertiserId}.png`]);

  for (const [eventId, metadata] of [
    ['evt_expired_existing', { ...expiredSession.metadata, kind: 'existing' }],
    ['evt_expired_foreign_logo', {
      ...expiredSession.metadata,
      logo_key: 'logos/99999999-9999-4999-8999-999999999999.png',
    }],
  ]) {
    const ignored = signedRequestBody(
      { ...expiredSession, metadata },
      eventId,
      'checkout.session.expired',
    );
    const ignoredResponse = await app.request(
      'http://localhost/webhooks/stripe',
      {
        method: 'POST',
        headers: { 'stripe-signature': ignored.signature },
        body: ignored.payload,
      },
      env,
    );
    assert.equal(ignoredResponse.status, 200);
  }

  assert.deepEqual(deletedKeys, [`logos/${advertiserId}.png`]);
});
