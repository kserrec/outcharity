import assert from 'node:assert/strict';
import test from 'node:test';

import { getConfig } from '../src/config.js';
import { app } from '../src/index.js';
import { homePage } from '../src/views.js';

function completeEnvironment() {
  return {
    OUTCHARITY_LAUNCH_APPROVED: 'true',
    SITE_URL: 'https://outcharity.com',
    CHARITY_NAME: 'Example Charity',
    CHARITY_URL: 'https://charity.example',
    CHARITY_EIN: '12-3456789',
    CHARITY_DISCLOSURE: 'Approved disclosure.',
    CAMPAIGN_HEADLINE: 'Buy the top spot. Help people.',
    CHARITY_PERCENTAGE: '90',
    PLATFORM_PERCENTAGE: '10',
    MIN_CONTRIBUTION_CENTS: '1000',
    MAX_CONTRIBUTION_CENTS: '100000000',
    STRIPE_SECRET_KEY: 'configured',
    STRIPE_WEBHOOK_SECRET: 'configured',
    GOODAPI_API_KEY: 'configured',
    DB: {},
    LOGOS: {},
  };
}

test('checkout cannot open without explicit approval and every required integration', () => {
  const environment = completeEnvironment();
  assert.equal(getConfig(environment, environment.SITE_URL).checkoutEnabled, true);

  for (const key of [
    'OUTCHARITY_LAUNCH_APPROVED',
    'CHARITY_DISCLOSURE',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'GOODAPI_API_KEY',
    'DB',
    'LOGOS',
  ]) {
    const incomplete = completeEnvironment();
    delete incomplete[key];
    assert.equal(getConfig(incomplete, incomplete.SITE_URL).checkoutEnabled, false, key);
  }

  const wrongAllocation = completeEnvironment();
  wrongAllocation.CHARITY_PERCENTAGE = '95';
  wrongAllocation.PLATFORM_PERCENTAGE = '5';
  const lockedConfig = getConfig(wrongAllocation, wrongAllocation.SITE_URL);
  assert.equal(lockedConfig.checkoutEnabled, false);
  assert.equal(lockedConfig.charityPercentage, 90);
  assert.equal(lockedConfig.platformPercentage, 10);
});

test('server-rendered listings escape advertiser-controlled HTML', () => {
  const environment = completeEnvironment();
  const config = getConfig(environment, environment.SITE_URL);
  const document = String(
    homePage(config, {
      grossCents: 1_000,
      charityCents: 900,
      advertisers: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: '<img src=x onerror=alert(1)>',
          description: '<script>alert(1)</script>',
          url: 'https://example.com/?value=<unsafe>',
          logo_key: 'logos/11111111-1111-4111-8111-111111111111.png',
          total_contributed_cents: 1_000,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    }),
  );

  assert.doesNotMatch(document, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(document, /<img src=x onerror/);
  assert.match(document, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(document, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(document, /content="Outcharity — Advertise by Giving"/);
  assert.match(document, /href="https:\/\/example\.com\/\?value=&lt;unsafe&gt;"/);
  assert.match(document, /src="\/logos\/11111111-1111-4111-8111-111111111111\.png"/);
  assert.doesNotMatch(document, /\/logos\/logos\//);
  assert.match(document, /Approved disclosure\./);
});

test('a success-page failure never claims that a completed payment was not charged', async (context) => {
  context.mock.method(console, 'error', () => {});
  const response = await app.request(
    'http://localhost/success?session_id=cs_test_12345678',
    {},
    {
      DB: {
        prepare() {
          throw new Error('database unavailable');
        },
      },
    },
  );
  const document = await response.text();

  assert.equal(response.status, 500);
  assert.doesNotMatch(document, /Nothing was charged/);
  assert.match(document, /If you just paid, check the leaderboard/);
});

test('the success page only claims payment after a confirmed contribution exists', async () => {
  const database = {
    prepare() {
      return {
        bind() {
          return this;
        },
        async first() {
          return null;
        },
      };
    },
  };

  for (const url of [
    'http://localhost/success',
    'http://localhost/success?session_id=not-stripe',
  ]) {
    const response = await app.request(url, {}, { DB: database });
    const document = await response.text();
    assert.equal(response.status, 400);
    assert.match(document, /That payment link is invalid/);
    assert.doesNotMatch(document, /Payment received|Payment successful/);
  }

  const pendingResponse = await app.request(
    'http://localhost/success?session_id=cs_test_12345678',
    {},
    { DB: database },
  );
  const pendingDocument = await pendingResponse.text();
  assert.equal(pendingResponse.status, 200);
  assert.match(pendingDocument, /Waiting for confirmation/);
  assert.match(pendingDocument, /If you completed payment/);
  assert.doesNotMatch(pendingDocument, /Payment received|Payment successful/);
});
