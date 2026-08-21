import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { app } from '../src/index.js';
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

test('the webhook route rejects a forged paid event before fulfillment', async (context) => {
  const db = new TestD1Database();
  const originalFetch = globalThis.fetch;
  let donationCalls = 0;
  context.mock.method(console, 'error', () => {});
  globalThis.fetch = async (_url, options) => {
    donationCalls += 1;
    const request = JSON.parse(options.body);
    return new Response(
      JSON.stringify({ donation_id: 'must-not-run', amount_cents: request.amount_cents }),
      { status: 200 },
    );
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
    db.close();
  });

  const forged = signedRequestBody(session('paid'), 'evt_forged');
  const wrongSignature = stripe.webhooks.generateTestHeaderString({
    payload: forged.payload,
    secret: 'whsec_wrong_secret',
  });
  const response = await app.request(
    'http://localhost/webhooks/stripe',
    {
      method: 'POST',
      headers: { 'stripe-signature': wrongSignature },
      body: forged.payload,
    },
    {
      DB: db,
      STRIPE_SECRET_KEY: 'sk_test_placeholder',
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      GOODAPI_API_KEY: 'goodapi-test-key',
    },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid webhook signature.' });
  const count = await db.prepare('SELECT COUNT(*) AS count FROM contributions').first();
  assert.equal(count.count, 0);
  assert.equal(donationCalls, 0);
});

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

test('an asynchronous paid webhook survives provider failure and scheduled retry', async (context) => {
  const db = new TestD1Database();
  const originalFetch = globalThis.fetch;
  let providerAvailable = false;
  let donationCalls = 0;
  context.mock.method(console, 'error', () => {});
  globalThis.fetch = async (_url, options) => {
    donationCalls += 1;
    const request = JSON.parse(options.body);
    if (!providerAvailable) {
      return new Response(JSON.stringify({ error: 'temporary provider failure' }), {
        status: 503,
      });
    }
    return new Response(
      JSON.stringify({ donation_id: 'goodapi-retried', amount_cents: request.amount_cents }),
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
  const asyncSession = {
    ...session('paid'),
    id: 'cs_test_webhook_async',
    payment_intent: 'pi_webhook_async',
  };
  const asynchronous = signedRequestBody(
    asyncSession,
    'evt_async_paid',
    'checkout.session.async_payment_succeeded',
  );
  const failedResponse = await app.request(
    'http://localhost/webhooks/stripe',
    {
      method: 'POST',
      headers: { 'stripe-signature': asynchronous.signature },
      body: asynchronous.payload,
    },
    env,
  );

  assert.equal(failedResponse.status, 500);
  assert.deepEqual(await failedResponse.json(), { error: 'Webhook fulfillment failed.' });
  let stored = await db
    .prepare(
      `SELECT charity_delivery_status, charity_delivery_attempts, goodapi_donation_id
       FROM contributions WHERE stripe_checkout_session_id = ?`,
    )
    .bind(asyncSession.id)
    .first();
  assert.deepEqual({ ...stored }, {
    charity_delivery_status: 'failed',
    charity_delivery_attempts: 1,
    goodapi_donation_id: null,
  });

  providerAvailable = true;
  let scheduledWork;
  worker.scheduled({}, env, {
    waitUntil(work) {
      scheduledWork = work;
    },
  });
  assert.ok(scheduledWork);
  await scheduledWork;

  stored = await db
    .prepare(
      `SELECT charity_delivery_status, charity_delivery_attempts, goodapi_donation_id
       FROM contributions WHERE stripe_checkout_session_id = ?`,
    )
    .bind(asyncSession.id)
    .first();
  assert.deepEqual({ ...stored }, {
    charity_delivery_status: 'delivered',
    charity_delivery_attempts: 2,
    goodapi_donation_id: 'goodapi-retried',
  });
  const count = await db.prepare('SELECT COUNT(*) AS count FROM contributions').first();
  const advertiser = await db
    .prepare('SELECT total_contributed_cents FROM advertisers WHERE id = ?')
    .bind(advertiserId)
    .first();
  assert.equal(count.count, 1);
  assert.equal(advertiser.total_contributed_cents, 1_000);
  assert.equal(donationCalls, 2);
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
