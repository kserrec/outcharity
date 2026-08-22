import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { app } from '../src/index.js';
import { deliverEligibleCharityPortions } from '../src/charity.js';
import { charityHoldDays, getConfig } from '../src/config.js';
import { newAdvertiserMetadata } from '../src/payments.js';
import { createStripeClient } from '../src/providers.js';
import { TestD1Database } from './helpers/d1.js';
import { configuredEnvironment } from './helpers/environment.js';

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

function signedRequestBody(
  checkoutSession,
  eventId,
  eventType = 'checkout.session.completed',
  { livemode = false, secret = webhookSecret } = {},
) {
  const payload = JSON.stringify({
    id: eventId,
    object: 'event',
    type: eventType,
    livemode,
    data: { object: checkoutSession },
  });
  return {
    payload,
    signature: stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
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
  const originalCaches = globalThis.caches;
  const purged = [];
  globalThis.caches = {
    default: {
      async match() { return undefined; },
      async put() {},
      async delete(request) { purged.push(new URL(request.url).pathname); return true; },
    },
  };
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
    globalThis.caches = originalCaches;
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
  // The charity share is held, not sent at confirmation time.
  assert.equal(donationCalls, 0);
  // Only the first (inserted) confirmation purges the cached homepage.
  assert.deepEqual(purged, ['/']);
  const held = await db.prepare('SELECT charity_delivery_status FROM contributions').first();
  assert.equal(held.charity_delivery_status, 'pending');
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

  assert.equal(failedResponse.status, 200);
  assert.deepEqual(await failedResponse.json(), { received: true, counted: true });
  const select = () =>
    db
      .prepare(
        `SELECT charity_delivery_status, charity_delivery_attempts, goodapi_donation_id
         FROM contributions WHERE stripe_checkout_session_id = ?`,
      )
      .bind(asyncSession.id)
      .first();
  let stored = await select();
  assert.deepEqual({ ...stored }, {
    charity_delivery_status: 'pending',
    charity_delivery_attempts: 0,
    goodapi_donation_id: null,
  });

  const runScheduled = async (environment) => {
    let scheduledWork;
    worker.scheduled({}, environment, {
      waitUntil(work) {
        scheduledWork = work;
      },
    });
    assert.ok(scheduledWork);
    await scheduledWork;
  };

  // Inside the hold window nothing is sent, even with the provider available.
  providerAvailable = true;
  await runScheduled(env);
  assert.equal(donationCalls, 0);
  assert.equal((await select()).charity_delivery_status, 'pending');

  // Just inside the window: still held. Once the hold has elapsed, a provider failure is
  // recorded and retried on the next run.
  providerAvailable = false;
  await deliverEligibleCharityPortions(env, fetch, { clockOffset: '+29 days' });
  assert.equal(donationCalls, 0);
  await deliverEligibleCharityPortions(env, fetch, { clockOffset: '+31 days' });
  stored = await select();
  assert.deepEqual({ ...stored }, {
    charity_delivery_status: 'failed',
    charity_delivery_attempts: 1,
    goodapi_donation_id: null,
  });

  // The real cron entry point performs the delivery once the hold no longer applies.
  providerAvailable = true;
  await runScheduled({ ...env, CHARITY_HOLD_DAYS: '0' });

  stored = await select();
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

test('an expired new-listing session deletes only its own uploaded logo', async (context) => {
  const deletedKeys = [];
  const db = new TestD1Database();
  context.after(() => db.close());
  const env = {
    DB: db,
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

  // Once the listing is confirmed, a signed expired event naming its logo deletes nothing.
  await db
    .prepare(
      `INSERT INTO advertisers (id, slug, name, description, url, logo_key, management_token_hash)
       VALUES (?, 'webhook-77777777', 'Webhook Company', 'd', 'https://example.com/', ?, ?)`,
    )
    .bind(advertiserId, `logos/${advertiserId}.png`, 'b'.repeat(64))
    .run();
  const confirmed = signedRequestBody(expiredSession, 'evt_expired_confirmed', 'checkout.session.expired');
  const confirmedResponse = await app.request(
    'http://localhost/webhooks/stripe',
    { method: 'POST', headers: { 'stripe-signature': confirmed.signature }, body: confirmed.payload },
    env,
  );
  assert.equal(confirmedResponse.status, 200);
  assert.deepEqual(deletedKeys, [`logos/${advertiserId}.png`]);
});

test('a signed event whose mode disagrees with the configured secret key is refused', async (context) => {
  const db = new TestD1Database();
  const originalFetch = globalThis.fetch;
  let donationCalls = 0;
  context.mock.method(console, 'error', () => {});
  globalThis.fetch = async () => {
    donationCalls += 1;
    return new Response('{}', { status: 200 });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
    db.close();
  });

  const cases = [
    ['sk_live_placeholder', false],
    ['sk_test_placeholder', true],
    ['rk_live_placeholder', false],
    ['not-a-stripe-key', true],
    ['not-a-stripe-key', false],
  ];
  for (const [secretKey, livemode] of cases) {
    const signed = signedRequestBody(session('paid'), `evt_mode_${livemode}`, undefined, { livemode });
    const response = await app.request(
      'http://localhost/webhooks/stripe',
      { method: 'POST', headers: { 'stripe-signature': signed.signature }, body: signed.payload },
      { DB: db, STRIPE_SECRET_KEY: secretKey, STRIPE_WEBHOOK_SECRET: webhookSecret, GOODAPI_API_KEY: 'k' },
    );
    assert.equal(response.status, 400, `${secretKey} livemode=${livemode}`);
    assert.deepEqual(await response.json(), {
      error: 'Webhook event mode does not match this deployment.',
    });
  }
  // An event with no livemode field at all is also refused.
  const missing = JSON.stringify({ id: 'evt_no_mode', object: 'event', type: 'checkout.session.completed', data: { object: session('paid') } });
  const missingResponse = await app.request(
    'http://localhost/webhooks/stripe',
    {
      method: 'POST',
      headers: { 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload: missing, secret: webhookSecret }) },
      body: missing,
    },
    { DB: db, STRIPE_SECRET_KEY: 'sk_test_placeholder', STRIPE_WEBHOOK_SECRET: webhookSecret, GOODAPI_API_KEY: 'k' },
  );
  assert.equal(missingResponse.status, 400);

  const count = await db.prepare('SELECT COUNT(*) AS count FROM contributions').first();
  assert.equal(count.count, 0);
  assert.equal(donationCalls, 0);
});

test('a signed refund or dispute hides the paid listing and purges its public cache entries', async (context) => {
  const db = new TestD1Database();
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const deleted = [];
  globalThis.fetch = async (_url, options) =>
    new Response(
      JSON.stringify({ donation_id: 'don_hide', amount_cents: JSON.parse(options.body).amount_cents }),
      { status: 200 },
    );
  globalThis.caches = {
    default: {
      async match() { return undefined; },
      async put() {},
      async delete(request) { deleted.push(new URL(request.url).pathname); return true; },
    },
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
    db.close();
  });
  const env = { DB: db, LOGOS: {}, STRIPE_SECRET_KEY: 'sk_test_placeholder', STRIPE_WEBHOOK_SECRET: webhookSecret, GOODAPI_API_KEY: 'k' };
  const post = (signed) =>
    app.request(
      'http://localhost/webhooks/stripe',
      { method: 'POST', headers: { 'stripe-signature': signed.signature }, body: signed.payload },
      env,
    );

  assert.equal((await post(signedRequestBody(session('paid'), 'evt_paid_hide'))).status, 200);
  const before = await db.prepare('SELECT is_hidden FROM advertisers WHERE id = ?').bind(advertiserId).first();
  assert.equal(before.is_hidden, 0);
  deleted.length = 0;

  // An event for a payment Outcharity never recorded changes nothing.
  const unknown = await post(
    signedRequestBody({ object: 'dispute', payment_intent: 'pi_unknown' }, 'evt_dispute_unknown', 'charge.dispute.created'),
  );
  assert.deepEqual(await unknown.json(), { received: true, counted: false, hidden: false });
  assert.equal(deleted.length, 0);

  const cases = [
    ['charge.dispute.created', { object: 'dispute', payment_intent: 'pi_webhook_paid' }],
    ['charge.refunded', { object: 'charge', payment_intent: { id: 'pi_webhook_paid' } }],
  ];
  for (const [type, object] of cases) {
    const response = await post(signedRequestBody(object, `evt_${type}`, type));
    assert.equal(response.status, 200, type);
    const body = await response.json();
    const row = await db.prepare('SELECT is_hidden FROM advertisers WHERE id = ?').bind(advertiserId).first();
    assert.equal(row.is_hidden, 1, type);
    if (type === 'charge.dispute.created') {
      assert.deepEqual(body, { received: true, counted: false, hidden: true });
      assert.deepEqual(deleted.sort(), ['/', `/logos/${advertiserId}.png`]);
    } else {
      // Already hidden: the second event is idempotent and purges nothing.
      assert.deepEqual(body, { received: true, counted: false, hidden: false });
      assert.equal(deleted.length, 2);
    }
  }

  const board = await app.request('http://localhost/', {}, env, { waitUntil() {} });
  assert.doesNotMatch(await board.text(), /Webhook Company/);
  const contributions = await db.prepare('SELECT COUNT(*) AS count FROM contributions').first();
  assert.equal(contributions.count, 1, 'the payment record is untouched');
});

test('the production site refuses test-mode events even when the key and secret are both test-mode', async (context) => {
  const db = new TestD1Database();
  context.mock.method(console, 'error', () => {});
  context.after(() => db.close());
  const signed = signedRequestBody(session('paid'), 'evt_both_test', undefined, { livemode: false });
  const response = await app.request(
    'https://outcharity.com/webhooks/stripe',
    { method: 'POST', headers: { 'stripe-signature': signed.signature }, body: signed.payload },
    { DB: db, SITE_URL: 'https://outcharity.com', STRIPE_SECRET_KEY: 'sk_test_placeholder', STRIPE_WEBHOOK_SECRET: webhookSecret, GOODAPI_API_KEY: 'k' },
  );
  assert.equal(response.status, 400);
  const count = await db.prepare('SELECT COUNT(*) AS count FROM contributions').first();
  assert.equal(count.count, 0);
});

test('a refund or dispute that arrives before the payment confirmation hides the listing and sends nothing to charity', async (context) => {
  const db = new TestD1Database();
  const originalFetch = globalThis.fetch;
  let donationCalls = 0;
  globalThis.fetch = async (_url, options) =>
    (donationCalls += 1) &&
    new Response(
      JSON.stringify({ donation_id: 'don_early', amount_cents: JSON.parse(options.body).amount_cents }),
      { status: 200 },
    );
  context.after(() => {
    globalThis.fetch = originalFetch;
    db.close();
  });
  const env = { DB: db, LOGOS: {}, STRIPE_SECRET_KEY: 'sk_test_placeholder', STRIPE_WEBHOOK_SECRET: webhookSecret, GOODAPI_API_KEY: 'k' };
  const post = (signed) =>
    app.request(
      'http://localhost/webhooks/stripe',
      { method: 'POST', headers: { 'stripe-signature': signed.signature }, body: signed.payload },
      env,
    );

  const early = await post(
    signedRequestBody({ object: 'charge', payment_intent: 'pi_webhook_paid' }, 'evt_early_refund', 'charge.refunded'),
  );
  assert.deepEqual(await early.json(), { received: true, counted: false, hidden: false });

  const completed = await post(signedRequestBody(session('paid'), 'evt_late_paid'));
  assert.deepEqual(await completed.json(), { received: true, counted: true });
  const row = await db.prepare('SELECT is_hidden, total_contributed_cents FROM advertisers WHERE id = ?').bind(advertiserId).first();
  assert.equal(row.is_hidden, 1);
  // Refunded money never counts toward the rank total.
  assert.equal(row.total_contributed_cents, 0);
  const board = await app.request('http://localhost/', {}, env, { waitUntil() {} });
  assert.doesNotMatch(await board.text(), /Webhook Company/);

  // Neither the webhook nor the scheduled delivery ever pays charity for a refunded payment,
  // even after the hold window has passed.
  assert.equal(donationCalls, 0);
  await deliverEligibleCharityPortions({ ...env, CHARITY_HOLD_DAYS: '0' });
  await deliverEligibleCharityPortions(env, fetch, { clockOffset: '+90 days' });
  assert.equal(donationCalls, 0);
  const status = await db.prepare('SELECT charity_delivery_status FROM contributions').first();
  assert.equal(status.charity_delivery_status, 'pending');
});

test('the charity hold defaults to thirty days, ignores malformed settings, and is one value for Terms and cron', () => {
  assert.equal(charityHoldDays({}), 30);
  for (const value of ['', '-1', 'now', '400', '1000', '7.5']) {
    assert.equal(charityHoldDays({ CHARITY_HOLD_DAYS: value }), 30, JSON.stringify(value));
  }
  assert.equal(charityHoldDays({ CHARITY_HOLD_DAYS: '0' }), 0);
  assert.equal(charityHoldDays({ CHARITY_HOLD_DAYS: '14' }), 14);
  assert.equal(charityHoldDays({ CHARITY_HOLD_DAYS: '365' }), 365);

  // Whatever the setting, the page text and the delivery task read the same number, and an
  // unusable setting is surfaced as a configuration issue that closes checkout.
  for (const [value, expected, valid] of [
    ['1000', 30, false],
    ['400', 30, false],
    ['abc', 30, false],
    ['30.0', 30, false],
    ['', 30, true],
    ['030', 30, true],
    ['14', 14, true],
    [30, 30, true],
  ]) {
    const env = configuredEnvironment({ CHARITY_HOLD_DAYS: value });
    const config = getConfig(env, env.SITE_URL);
    assert.equal(config.charityHoldDays, charityHoldDays(env), String(value));
    assert.equal(config.charityHoldDays, expected, String(value));
    // An otherwise complete deployment opens checkout only when the hold value is usable.
    assert.equal(config.checkoutEnabled, valid, String(value));
  }
});

test('a refund or dispute after the charity share is delivered still hides the listing', async (context) => {
  const db = new TestD1Database();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) =>
    new Response(
      JSON.stringify({ donation_id: 'don_late', amount_cents: JSON.parse(options.body).amount_cents }),
      { status: 200 },
    );
  context.after(() => {
    globalThis.fetch = originalFetch;
    db.close();
  });
  const env = { DB: db, LOGOS: {}, STRIPE_SECRET_KEY: 'sk_test_placeholder', STRIPE_WEBHOOK_SECRET: webhookSecret, GOODAPI_API_KEY: 'k', CHARITY_HOLD_DAYS: '0' };
  const post = (signed) =>
    app.request(
      'http://localhost/webhooks/stripe',
      { method: 'POST', headers: { 'stripe-signature': signed.signature }, body: signed.payload },
      env,
    );
  await post(signedRequestBody(session('paid'), 'evt_paid_then_disputed'));
  assert.deepEqual(await deliverEligibleCharityPortions(env), { attempted: 1, delivered: 1 });
  const late = await post(
    signedRequestBody({ object: 'dispute', payment_intent: 'pi_webhook_paid' }, 'evt_late_dispute', 'charge.dispute.created'),
  );
  assert.deepEqual(await late.json(), { received: true, counted: false, hidden: true });
  const row = await db.prepare('SELECT is_hidden FROM advertisers WHERE id = ?').bind(advertiserId).first();
  assert.equal(row.is_hidden, 1);
});

test('a dispute or refund that names only the charge is resolved to its payment through Stripe', async (context) => {
  const db = new TestD1Database();
  const originalFetch = globalThis.fetch;
  const stripeLookups = [];
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.includes('api.stripe.com')) {
      stripeLookups.push(target);
      const known = target.endsWith('/v1/charges/ch_known');
      return new Response(
        JSON.stringify(known ? { id: 'ch_known', object: 'charge', payment_intent: 'pi_webhook_paid' } : { error: { message: 'No such charge' } }),
        { status: known ? 200 : 404, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ donation_id: 'don_x', amount_cents: JSON.parse(options.body).amount_cents }),
      { status: 200 },
    );
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
    db.close();
  });
  const env = { DB: db, LOGOS: {}, STRIPE_SECRET_KEY: 'sk_test_placeholder', STRIPE_WEBHOOK_SECRET: webhookSecret, GOODAPI_API_KEY: 'k' };
  const post = (signed) =>
    app.request(
      'http://localhost/webhooks/stripe',
      { method: 'POST', headers: { 'stripe-signature': signed.signature }, body: signed.payload },
      env,
    );
  const hidden = () => db.prepare('SELECT is_hidden FROM advertisers WHERE id = ?').bind(advertiserId).first();

  await post(signedRequestBody(session('paid'), 'evt_paid_charge_only'));
  assert.equal((await hidden()).is_hidden, 0);

  // Unknown charge: Stripe says no such charge; nothing is hidden and the request still succeeds.
  context.mock.method(console, 'error', () => {});
  const unknown = await post(
    signedRequestBody({ object: 'dispute', payment_intent: null, charge: 'ch_unknown' }, 'evt_dispute_unknown_charge', 'charge.dispute.created'),
  );
  assert.equal(unknown.status, 500, 'a failed Stripe lookup is reported so Stripe retries');
  assert.equal((await hidden()).is_hidden, 0);

  const known = await post(
    signedRequestBody({ object: 'dispute', payment_intent: null, charge: { id: 'ch_known' } }, 'evt_dispute_known_charge', 'charge.dispute.created'),
  );
  assert.deepEqual(await known.json(), { received: true, counted: false, hidden: true });
  assert.equal((await hidden()).is_hidden, 1);
  assert.ok(stripeLookups.some((target) => target.endsWith('/v1/charges/ch_known')));
  assert.equal(stripeLookups.filter((target) => target.endsWith('/v1/charges/ch_known')).length, 1);
});

test('public totals exclude refunded or disputed payments while the immutable rows remain', async (context) => {
  const db = new TestD1Database();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 500 });
  context.after(() => {
    globalThis.fetch = originalFetch;
    db.close();
  });
  const env = configuredEnvironment({
    SITE_URL: 'http://localhost',
    DB: db,
    STRIPE_SECRET_KEY: 'sk_test_placeholder',
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  });
  const post = (signed) =>
    app.request(
      'http://localhost/webhooks/stripe',
      { method: 'POST', headers: { 'stripe-signature': signed.signature }, body: signed.payload },
      env,
    );
  const otherId = '88888888-8888-4888-8888-888888888888';
  const other = {
    ...session('paid'),
    id: 'cs_test_other_paid',
    payment_intent: 'pi_other_paid',
    amount_total: 5_000,
    metadata: {
      ...session('paid').metadata,
      advertiser_id: otherId,
      requested_amount_cents: '5000',
      slug: 'other-88888888',
      name: 'Other Company',
      logo_key: `logos/${otherId}.png`,
      management_token_hash: 'c'.repeat(64),
    },
  };
  await post(signedRequestBody(session('paid'), 'evt_totals_a'));
  await post(signedRequestBody(other, 'evt_totals_b'));
  const before = await app.request('http://localhost/', {}, env, { waitUntil() {} });
  assert.match(await before.text(), /<strong>\$60<\/strong>\s*<span>confirmed giving/);

  await post(signedRequestBody({ object: 'charge', payment_intent: 'pi_webhook_paid' }, 'evt_totals_refund', 'charge.refunded'));
  const after = await app.request('http://localhost/', {}, env, { waitUntil() {} });
  const html = await after.text();
  assert.match(html, /<strong>\$50<\/strong>\s*<span>confirmed giving/);
  assert.match(html, /<strong>\$45<\/strong> to charity/);
  assert.doesNotMatch(html, /Webhook Company/);
  assert.match(html, /Other Company/);
  const rows = await db.prepare('SELECT COUNT(*) AS count FROM contributions').first();
  assert.equal(rows.count, 2, 'the refunded row is kept, only excluded from public totals');
});
