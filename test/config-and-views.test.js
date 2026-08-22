import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getConfig } from '../src/config.js';
import { hashToken } from '../src/domain.js';
import { app } from '../src/index.js';
import { homePage, termsPage } from '../src/views.js';

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
    CHECKOUT_RATE_LIMITER: { limit() {} },
    LOOKUP_RATE_LIMITER: { limit() {} },
  };
}

test('production configuration pins the approved live campaign', () => {
  const deployment = JSON.parse(
    readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
  );

  assert.equal(deployment.vars.OUTCHARITY_LAUNCH_APPROVED, 'true');
  assert.equal(deployment.vars.CHARITY_NAME, 'St Jude Childrens Research Hospital');
  assert.equal(deployment.vars.CHARITY_URL, 'https://www.stjude.org');
  assert.equal(deployment.vars.CHARITY_EIN, '620646012');
  assert.equal(
    deployment.vars.CAMPAIGN_HEADLINE,
    'Buy the top spot. Help the featured charity.',
  );
  assert.equal(
    deployment.vars.CHARITY_DISCLOSURE,
    'Outcharity is not affiliated with or endorsed by St. Jude Children’s Research Hospital. Each payment purchases advertising and is not represented as a tax-deductible charitable gift by the advertiser. Of each gross payment, 90% is directed to St Jude Childrens Research Hospital through GoodAPI and 10% supports Outcharity. Outcharity separately absorbs payment-processing fees; those fees do not reduce the 90% charity allocation.',
  );
});

test('terms publish the approved refund and dispute promises', () => {
  const environment = completeEnvironment();
  const document = String(termsPage(getConfig(environment, environment.SITE_URL)));

  assert.match(document, /<h2>Refunds and disputes<\/h2>/);
  assert.match(document, /Rank changes are an expected part of the product/);
  assert.match(document, /full refund\s+through Stripe to the original payment method/);
  assert.match(document, /removed for violating the\s+published listing rules does not qualify/);
  assert.match(document, /Outcharity bears any charity allocation or processing cost it\s+cannot recover/);
  assert.match(document, /charity-provider record correction are separate operations/);
  assert.match(document, /applicable card-network process/);
  assert.match(document, /Nothing in these Terms limits rights that cannot legally be waived/);
  assert.doesNotMatch(document, /Final refund, chargeback/);
});

test('checkout cannot open without explicit approval and every required integration', () => {
  const environment = completeEnvironment();
  assert.equal(getConfig(environment, environment.SITE_URL).checkoutEnabled, true);

  for (const key of [
    'OUTCHARITY_LAUNCH_APPROVED',
    'CHARITY_NAME',
    'CHARITY_URL',
    'CHARITY_EIN',
    'CHARITY_DISCLOSURE',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'GOODAPI_API_KEY',
    'DB',
    'LOGOS',
    'CHECKOUT_RATE_LIMITER',
    'LOOKUP_RATE_LIMITER',
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

  const missingProductionOrigin = completeEnvironment();
  delete missingProductionOrigin.SITE_URL;
  assert.equal(
    getConfig(missingProductionOrigin, 'https://outcharity.com').checkoutEnabled,
    false,
  );

  const alternateOrigin = completeEnvironment();
  assert.equal(
    getConfig(alternateOrigin, 'https://outcharity.example').checkoutEnabled,
    false,
  );
});

test('both checkout routes honor the disabled launch gate before downstream work', async (context) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Stripe must not be reached while checkout is disabled');
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const environment = completeEnvironment();
  environment.OUTCHARITY_LAUNCH_APPROVED = 'false';
  environment.DB = {
    prepare() {
      throw new Error('D1 must not be reached while checkout is disabled');
    },
  };
  environment.LOGOS = {
    async put() {
      throw new Error('R2 must not be reached while checkout is disabled');
    },
  };
  const rejectingLimiter = {
    async limit() {
      throw new Error('rate limiting must not run while checkout is disabled');
    },
  };
  environment.CHECKOUT_RATE_LIMITER = rejectingLimiter;
  environment.LOOKUP_RATE_LIMITER = rejectingLimiter;

  for (const path of [
    '/checkout',
    `/manage/${'a'.repeat(64)}/checkout`,
  ]) {
    const response = await app.fetch(
      new Request(`https://outcharity.com${path}`, {
        method: 'POST',
        headers: { Origin: 'https://outcharity.com' },
        body: new URLSearchParams({ amount: '25' }),
      }),
      environment,
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 503, path);
    assert.match(await response.text(), /Checkout is not open yet/, path);
  }
});

test('the new-listing route sends validated cents and matching fulfillment data to Stripe', async (context) => {
  const originalFetch = globalThis.fetch;
  let stripeRequest;
  globalThis.fetch = async (url, options) => {
    stripeRequest = { url: String(url), options };
    return new Response(
      JSON.stringify({
        id: 'cs_test_route_checkout',
        object: 'checkout.session',
        url: 'https://checkout.stripe.com/c/pay/route-test',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const uploaded = [];
  const environment = completeEnvironment();
  environment.STRIPE_SECRET_KEY = 'sk_test_placeholder';
  environment.CHECKOUT_RATE_LIMITER = {
    async limit() {
      return { success: true };
    },
  };
  environment.LOGOS = {
    async put(key, bytes, options) {
      uploaded.push({ key, bytes, options });
    },
    async delete() {},
  };
  const form = new FormData();
  form.set('name', 'Route Company');
  form.set('url', 'https://example.com');
  form.set('description', 'A complete route-to-Stripe integration test.');
  form.set('amount', '25.01');
  form.set(
    'logo',
    new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], 'logo.png', {
      type: 'image/png',
    }),
  );

  const response = await app.fetch(
    new Request('https://outcharity.com/checkout', {
      method: 'POST',
      headers: { Origin: 'https://outcharity.com' },
      body: form,
    }),
    environment,
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 303);
  assert.ok(stripeRequest, 'Stripe request was not sent');
  const stripeBody = new URLSearchParams(String(stripeRequest.options.body));
  assert.equal(response.headers.get('Location'), 'https://checkout.stripe.com/c/pay/route-test');
  assert.equal(stripeRequest.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(stripeBody.get('line_items[0][price_data][unit_amount]'), '2501');
  assert.equal(stripeBody.get('metadata[requested_amount_cents]'), '2501');
  assert.equal(stripeBody.get('metadata[kind]'), 'new');
  assert.equal(stripeBody.get('metadata[name]'), 'Route Company');
  assert.equal(
    stripeBody.get('metadata[description]'),
    'A complete route-to-Stripe integration test.',
  );
  assert.equal(stripeBody.get('metadata[url]'), 'https://example.com/');
  assert.equal(stripeBody.get('metadata[charity_name]'), 'Example Charity');
  assert.equal(stripeBody.get('metadata[charity_ein]'), '12-3456789');
  assert.equal(
    stripeBody.get('client_reference_id'),
    stripeBody.get('metadata[advertiser_id]'),
  );
  assert.equal(
    stripeBody.get('payment_intent_data[metadata][advertiser_id]'),
    stripeBody.get('metadata[advertiser_id]'),
  );
  assert.equal(stripeBody.get('cancel_url'), 'https://outcharity.com/submit?amount=25.01');
  const successUrl = new URL(stripeBody.get('success_url'));
  const managementToken = successUrl.searchParams.get('manage');
  assert.match(managementToken, /^[a-f0-9]{64}$/);
  assert.equal(
    stripeBody.get('metadata[management_token_hash]'),
    await hashToken(managementToken),
  );
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].key, stripeBody.get('metadata[logo_key]'));
  assert.equal(uploaded[0].options.httpMetadata.contentType, 'image/png');
});

test('the give-more route sends entered cents and the managed advertiser to Stripe', async (context) => {
  const originalFetch = globalThis.fetch;
  let stripeRequest;
  globalThis.fetch = async (url, options) => {
    stripeRequest = { url: String(url), options };
    return new Response(
      JSON.stringify({
        id: 'cs_test_route_give_more',
        object: 'checkout.session',
        url: 'https://checkout.stripe.com/c/pay/give-more-test',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const managementToken = 'a'.repeat(64);
  const advertiserId = '22222222-2222-4222-8222-222222222222';
  let boundTokenHash;
  const environment = completeEnvironment();
  environment.STRIPE_SECRET_KEY = 'sk_test_placeholder';
  environment.CHECKOUT_RATE_LIMITER = {
    async limit() {
      return { success: true };
    },
  };
  environment.DB = {
    prepare() {
      return {
        bind(tokenHash) {
          boundTokenHash = tokenHash;
          return this;
        },
        async first() {
          return {
            id: advertiserId,
            name: 'Managed Company',
            total_contributed_cents: 3_200,
            is_hidden: 0,
            rank: 4,
          };
        },
      };
    },
  };
  environment.LOGOS = {
    async put() {
      throw new Error('give-more checkout must not upload a logo');
    },
  };

  const response = await app.fetch(
    new Request(`https://outcharity.com/manage/${managementToken}/checkout`, {
      method: 'POST',
      headers: { Origin: 'https://outcharity.com' },
      body: new URLSearchParams({ amount: '32.01' }),
    }),
    environment,
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 303);
  assert.ok(stripeRequest, 'Stripe request was not sent');
  const stripeBody = new URLSearchParams(String(stripeRequest.options.body));
  assert.equal(response.headers.get('Location'), 'https://checkout.stripe.com/c/pay/give-more-test');
  assert.equal(stripeRequest.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(boundTokenHash, await hashToken(managementToken));
  assert.equal(stripeBody.get('line_items[0][price_data][unit_amount]'), '3201');
  assert.equal(stripeBody.get('metadata[requested_amount_cents]'), '3201');
  assert.equal(stripeBody.get('metadata[kind]'), 'existing');
  assert.equal(stripeBody.get('metadata[advertiser_id]'), advertiserId);
  assert.equal(stripeBody.get('client_reference_id'), advertiserId);
  assert.equal(
    stripeBody.get('success_url'),
    `https://outcharity.com/success?session_id={CHECKOUT_SESSION_ID}&manage=${managementToken}`,
  );
  assert.equal(
    stripeBody.get('cancel_url'),
    `https://outcharity.com/manage/${managementToken}`,
  );
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

test('homepage elevates the top three and makes every listing a full-card website link', () => {
  const environment = completeEnvironment();
  const config = getConfig(environment, environment.SITE_URL);
  const advertisers = [
    ['First Company', 'https://first.example/', 40_000],
    ['Second Company', 'https://second.example/', 30_000],
    ['Third Company', 'https://third.example/', 20_000],
    ['Fourth Company', 'https://fourth.example/', 10_000],
  ].map(([name, url, total], index) => ({
    id: `${index + 1}1111111-1111-4111-8111-111111111111`,
    name,
    description: `${name} description`,
    url,
    logo_key: `logos/company-${index + 1}.png`,
    total_contributed_cents: total,
    created_at: `2026-01-0${index + 1}T00:00:00.000Z`,
  }));
  const document = String(
    homePage(config, {
      grossCents: 100_000,
      charityCents: 90_000,
      advertisers,
    }),
  );

  const primaryIndex = document.indexOf('class="leader-primary"');
  const firstIndex = document.indexOf('data-rank="1"');
  const runnersIndex = document.indexOf('class="leader-runners"');
  const secondIndex = document.indexOf('data-rank="2"');
  const thirdIndex = document.indexOf('data-rank="3"');
  const restIndex = document.indexOf('class="listing-stack listing-stack-rest"');
  const fourthIndex = document.indexOf('data-rank="4"');

  assert.ok(primaryIndex >= 0 && primaryIndex < firstIndex);
  assert.ok(firstIndex < runnersIndex && runnersIndex < secondIndex);
  assert.ok(secondIndex < thirdIndex && thirdIndex < restIndex);
  assert.ok(restIndex < fourthIndex);
  assert.match(document, /class="listing-card listing-card-first" data-rank="1"/);
  assert.equal(document.match(/class="listing-hit-area"/g)?.length, advertisers.length);

  for (const advertiser of advertisers) {
    const hrefIndex = document.indexOf(`href="${advertiser.url}"`);
    const anchorStart = document.lastIndexOf('class="listing-hit-area"', hrefIndex);
    const anchorEnd = document.indexOf('></a>', hrefIndex);
    const anchor = document.slice(anchorStart, anchorEnd);

    assert.ok(hrefIndex >= 0, advertiser.name);
    assert.ok(anchorStart >= 0 && hrefIndex - anchorStart < 100, advertiser.name);
    assert.match(anchor, /target="_blank"/);
    assert.match(anchor, /rel="noopener sponsored"/);
    assert.match(anchor, new RegExp(`aria-label="Visit ${advertiser.name}"`));
  }
});

test('locked empty homepage makes the open top spot prominent without implying checkout is open', () => {
  const environment = completeEnvironment();
  environment.OUTCHARITY_LAUNCH_APPROVED = 'false';
  const config = getConfig(environment, environment.SITE_URL);
  const document = String(
    homePage(config, { grossCents: 0, charityCents: 0, advertisers: [] }),
  );

  assert.match(document, /class="empty-rank"[^>]*>#1</);
  assert.match(document, /The first confirmed listing owns the top spot/);
  assert.match(document, /No filler listings\. No made-up activity\./);
  assert.match(document, /Opening after final checks/);
  assert.match(document, /Checkout stays closed until every launch check\s+passes/);
  assert.doesNotMatch(document, /href="\/submit"/);
  assert.doesNotMatch(document, /class="listing-hit-area"/);
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
