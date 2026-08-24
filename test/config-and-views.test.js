import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getConfig } from '../src/config.js';
import { hashToken } from '../src/domain.js';
import { app } from '../src/index.js';
import { homePage, statsPage, submitPage, termsPage } from '../src/views.js';
import {
  configuredEnvironment as completeEnvironment,
  executionContext,
} from './helpers/environment.js';
import { pngBytes } from './helpers/images.js';

test('production configuration pins the approved live campaign', () => {
  const deployment = JSON.parse(
    readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
  );

  assert.equal(deployment.vars.OUTCHARITY_LAUNCH_APPROVED, 'true');
  assert.equal(deployment.vars.CLOUDFLARE_ACCOUNT_ID, '82901762bf678507dc432f37e1bcb440');
  assert.equal(deployment.vars.WEB_ANALYTICS_START_DATE, '2026-08-21');
  assert.equal(deployment.vars.WEB_ANALYTICS_BASELINE_VISITS, '368');
  assert.equal(deployment.vars.CHARITY_NAME, 'St Jude Childrens Research Hospital');
  assert.equal(deployment.vars.CHARITY_URL, 'https://www.stjude.org');
  assert.equal(deployment.vars.CHARITY_EIN, '620646012');
  assert.equal(
    deployment.vars.CAMPAIGN_HEADLINE,
    'Buy Clout. Do good.',
  );
  assert.equal(deployment.vars.MIN_CONTRIBUTION_CENTS, '100');
  assert.equal(deployment.vars.MAX_CONTRIBUTION_CENTS, '10000000');
  assert.equal(deployment.vars.CHARITY_HOLD_DAYS, '30');
  assert.equal(
    deployment.vars.CHARITY_DISCLOSURE,
    'Outcharity is not affiliated with or endorsed by St. Jude Children’s Research Hospital. Each payment purchases advertising and is not represented as a tax-deductible charitable gift by the advertiser. Of each gross payment, 90% is directed to St Jude Childrens Research Hospital through GoodAPI and 10% supports Outcharity. Outcharity separately absorbs payment-processing fees; those fees do not reduce the 90% charity allocation.',
  );
});

test('the default contribution starts at the one-dollar minimum', () => {
  const environment = completeEnvironment();
  delete environment.MIN_CONTRIBUTION_CENTS;
  delete environment.CAMPAIGN_HEADLINE;
  const config = getConfig(environment, environment.SITE_URL);
  const document = String(submitPage(config));

  assert.equal(config.minimumCents, 100);
  assert.equal(config.campaignHeadline, 'Buy Clout. Do good.');
  assert.match(document, /data-amount="1"/);
  assert.match(document, /name="amount"\s+value="1"/);
  assert.match(document, /Minimum \$1\./);
});

test('terms publish the approved refund and dispute promises', () => {
  const environment = completeEnvironment();
  const document = String(termsPage(getConfig(environment, environment.SITE_URL)));

  assert.match(document, /<h2>Refunds and disputes<\/h2>/);
  assert.match(document, /Rank changes are an expected part of the product/);
  assert.match(document, /full refund\s+through\s+Stripe to the original payment\s+method/);
  assert.match(document, /removed for violating the\s+published\s+listing rules does not qualify/);
  assert.match(document, /Within 30 days of payment/);
  assert.match(document, /After 30 days a payment is final/);
  assert.doesNotMatch(document, /bears any charity allocation/);
  assert.match(document, /applicable\s+card-network process/);
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

  for (const [key, value, issue] of [
    ['MIN_CONTRIBUTION_CENTS', '49', /below Stripe’s USD minimum/],
    ['MAX_CONTRIBUTION_CENTS', '100000000', /exceeds Stripe’s USD maximum/],
  ]) {
    const outsideStripeLimits = completeEnvironment({ [key]: value });
    const config = getConfig(outsideStripeLimits, outsideStripeLimits.SITE_URL);
    assert.equal(config.checkoutEnabled, false, key);
    assert.match(config.issues.join(' '), issue, key);
  }
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
      executionContext,
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
  environment.STRIPE_SECRET_KEY = 'sk_live_placeholder';
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
    new File([pngBytes()], 'logo.png', {
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
    executionContext,
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
  const advertiserId = stripeBody.get('metadata[advertiser_id]');
  const setCookie = response.headers.get('Set-Cookie');
  const managementToken = /__Host-outcharity-manage-[0-9a-f]{32}=([a-f0-9]{64});/.exec(
    setCookie,
  )?.[1];
  assert.match(managementToken, /^[a-f0-9]{64}$/);
  assert.equal(successUrl.searchParams.get('advertiser_id'), advertiserId);
  assert.equal(successUrl.searchParams.has('manage'), false);
  assert.doesNotMatch(stripeBody.get('success_url'), new RegExp(managementToken));
  assert.equal(
    stripeBody.get('metadata[management_token_hash]'),
    await hashToken(managementToken),
  );
  assert.match(setCookie, /; HttpOnly/);
  assert.match(setCookie, /; Max-Age=172800/);
  assert.match(setCookie, /; Path=\//);
  assert.match(setCookie, /; SameSite=Lax/);
  assert.match(setCookie, /; Secure/);
  assert.match(setCookie, /; Priority=High/);
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
  environment.STRIPE_SECRET_KEY = 'sk_live_placeholder';
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
    executionContext,
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
    `https://outcharity.com/success?session_id={CHECKOUT_SESSION_ID}&advertiser_id=${advertiserId}`,
  );
  assert.equal(
    stripeBody.get('cancel_url'),
    `https://outcharity.com/manage-return?advertiser_id=${advertiserId}`,
  );
  assert.doesNotMatch(stripeBody.get('success_url'), new RegExp(managementToken));
  assert.doesNotMatch(stripeBody.get('cancel_url'), new RegExp(managementToken));
  assert.match(
    response.headers.get('Set-Cookie'),
    new RegExp(
      `^__Host-outcharity-manage-${advertiserId.replaceAll('-', '')}=${managementToken};`,
    ),
  );
});

test('private management credentials stay out of page metadata, return through the browser cookie, and are never echoed for a foreign or wrong token', async () => {
  const managementToken = 'a'.repeat(64);
  const advertiserId = '22222222-2222-4222-8222-222222222222';
  const managementTokenHash = await hashToken(managementToken);
  const advertiser = {
    id: advertiserId,
    advertiser_id: advertiserId,
    name: 'Managed Company',
    total_contributed_cents: 3_200,
    charity_name: 'Example Charity',
    management_token_hash: managementTokenHash,
    is_hidden: 0,
    rank: 4,
  };
  const environment = completeEnvironment({
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            return advertiser;
          },
        };
      },
    },
  });

  const manageResponse = await app.fetch(
    new Request(`https://outcharity.com/manage/${managementToken}`),
    environment,
    executionContext,
  );
  const manageDocument = await manageResponse.text();
  assert.equal(manageResponse.status, 200);
  assert.equal(manageResponse.headers.get('Referrer-Policy'), 'origin');
  assert.equal(manageResponse.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
  assert.match(manageResponse.headers.get('Cache-Control'), /(?:^|, )no-transform(?:,|$)/);
  assert.doesNotMatch(
    manageResponse.headers.get('Content-Security-Policy'),
    /static\.cloudflareinsights\.com/,
  );
  assert.doesNotMatch(manageDocument, /rel="canonical"/);
  assert.doesNotMatch(manageDocument, /property="og:url"/);
  assert.match(manageDocument, /name="robots" content="noindex,nofollow,noarchive"/);

  const cookieName = `__Host-outcharity-manage-${advertiserId.replaceAll('-', '')}`;
  const successUrl =
    `https://outcharity.com/success?session_id=cs_test_12345678&advertiser_id=${advertiserId}`;
  const successResponse = await app.fetch(
    new Request(successUrl, { headers: { Cookie: `${cookieName}=${managementToken}` } }),
    environment,
    executionContext,
  );
  assert.equal(successResponse.status, 200);
  assert.match(await successResponse.text(), new RegExp(`/manage/${managementToken}`));

  const otherAdvertiserId = '33333333-3333-4333-8333-333333333333';
  const otherCookieName = `__Host-outcharity-manage-${otherAdvertiserId.replaceAll('-', '')}`;
  for (const request of [
    new Request(successUrl),
    new Request(
      `https://outcharity.com/success?session_id=cs_test_12345678&advertiser_id=${otherAdvertiserId}`,
      { headers: { Cookie: `${cookieName}=${managementToken}` } },
    ),
    // A cookie for a different listing carries a token that does not hash to this listing's
    // credential, so no link is shown.
    new Request(
      `https://outcharity.com/success?session_id=cs_test_12345678&advertiser_id=${otherAdvertiserId}`,
      { headers: { Cookie: `${otherCookieName}=${'b'.repeat(64)}` } },
    ),
    // A cookie whose token does not hash to the stored credential must not be shown.
    new Request(successUrl, { headers: { Cookie: `${cookieName}=${'c'.repeat(64)}` } }),
  ]) {
    const response = await app.fetch(request, environment, executionContext);
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /\/manage\/[a-f0-9]{64}/, request.url);
  }

  const returnResponse = await app.fetch(
    new Request(`https://outcharity.com/manage-return?advertiser_id=${advertiserId}`, {
      headers: { Cookie: `${cookieName}=${managementToken}` },
    }),
    environment,
    executionContext,
  );
  assert.equal(returnResponse.status, 303);
  assert.equal(returnResponse.headers.get('Location'), `/manage/${managementToken}`);

  const missingCookieResponse = await app.fetch(
    new Request(`https://outcharity.com/manage-return?advertiser_id=${advertiserId}`),
    environment,
    executionContext,
  );
  assert.equal(missingCookieResponse.status, 404);
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

test('recent activity is recency-only, capped at three, compact, and below the leaderboard', () => {
  const environment = completeEnvironment();
  const config = getConfig(environment, environment.SITE_URL);
  const recentPayments = [
    ['Newest Company', 'https://newest.example/', 'newest'],
    ['Second Newest', 'https://second-newest.example/', 'second'],
    ['Third Newest', 'https://third-newest.example/', 'third'],
    ['Must Stay Hidden', 'https://fourth-newest.example/', 'fourth'],
  ].map(([name, url, key], index) => ({
    id: `${index + 5}1111111-1111-4111-8111-111111111111`,
    name,
    url,
    logo_key: `logos/${key}.png`,
  }));
  const document = String(
    homePage(config, {
      grossCents: 100_000,
      charityCents: 90_000,
      advertisers: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Leaderboard Leader',
          description: 'The large primary listing.',
          url: 'https://leader.example/',
          logo_key: 'logos/leader.png',
          total_contributed_cents: 100_000,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      recentPayments,
    }),
  );
  const allocationIndex = document.indexOf('class="allocation-panel"');
  const recentIndex = document.indexOf('class="recent-activity"');
  const footerIndex = document.indexOf('class="site-footer"');
  const activity = document.slice(recentIndex, footerIndex);

  assert.ok(allocationIndex >= 0 && allocationIndex < recentIndex);
  assert.equal(activity.match(/class="recent-payment-link"/g)?.length, 3);
  assert.ok(activity.indexOf('Newest Company') < activity.indexOf('Second Newest'));
  assert.ok(activity.indexOf('Second Newest') < activity.indexOf('Third Newest'));
  assert.doesNotMatch(activity, /Must Stay Hidden/);
  assert.doesNotMatch(activity, /class="listing-card/);
  assert.doesNotMatch(activity, /\$\d/);
  assert.match(activity, /ordered by recency—not amount/);
  assert.match(activity, /rel="noopener sponsored"/);

  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const mobileStart = styles.indexOf('@media (max-width: 760px)');
  const desktopStyles = styles.slice(0, mobileStart);
  const mobileStyles = styles.slice(mobileStart, styles.indexOf('@media (max-width: 350px)'));
  const desktopList = desktopStyles.match(/\.recent-payment-list\s*\{([^}]*)\}/)?.[1] || '';
  const desktopLink = desktopStyles.match(/\.recent-payment-link\s*\{([^}]*)\}/)?.[1] || '';
  const mobileLink = mobileStyles.match(/\.recent-payment-link\s*\{([^}]*)\}/)?.[1] || '';
  const mobileLogo = mobileStyles.match(/\.recent-payment-logo\s*\{([^}]*)\}/)?.[1] || '';

  assert.match(desktopList, /grid-template-columns:\s*repeat\(3,/);
  assert.match(desktopLink, /height:\s*50px/);
  assert.match(mobileLink, /height:\s*54px/);
  assert.match(mobileLogo, /display:\s*none/);
});

test('mobile homepage leaves only the CTA visible in the unframed campaign status', () => {
  const environment = completeEnvironment();
  const config = getConfig(environment, environment.SITE_URL);
  const document = String(
    homePage(config, { grossCents: 0, charityCents: 0, advertisers: [] }),
  );
  const styles = readFileSync(
    new URL('../public/styles.css', import.meta.url),
    'utf8',
  );
  const mobileStart = styles.indexOf('@media (max-width: 760px)');
  const mobileEnd = styles.indexOf('@media (max-width: 350px)');
  const desktopStyles = styles.slice(0, mobileStart);
  const mobileStyles = styles.slice(mobileStart, mobileEnd);
  const desktopStatus = desktopStyles.match(/\.campaign-status\s*\{([^}]*)\}/)?.[1] || '';
  const mobileStatus = mobileStyles.match(/\.campaign-status\s*\{([^}]*)\}/)?.[1] || '';
  const mobileTotals =
    mobileStyles.match(/\.campaign-total,\s*\.charity-total\s*\{([^}]*)\}/)?.[1] || '';

  assert.match(document, /The remaining 10% keeps Outcharity running\./);
  assert.doesNotMatch(document, /The remaining 10% supports Outcharity\./);
  assert.match(desktopStatus, /border:\s*1px solid var\(--ink\)/);
  assert.match(desktopStatus, /border-radius:\s*14px/);
  assert.match(desktopStatus, /background:\s*var\(--card\)/);
  assert.match(desktopStatus, /box-shadow:\s*4px 4px 0 var\(--sun\)/);
  assert.match(mobileStatus, /padding:\s*0/);
  assert.match(mobileStatus, /border:\s*0/);
  assert.match(mobileStatus, /background:\s*transparent/);
  assert.match(mobileStatus, /box-shadow:\s*none/);
  assert.match(mobileTotals, /display:\s*none/);
});

test('the stats page defines six public aggregates and stacks each card on mobile', () => {
  const environment = completeEnvironment();
  const config = getConfig(environment, environment.SITE_URL);
  const document = String(
    statsPage(config, {
      totalPaidCents: 12_345,
      charityCents: 11_111,
      paymentCount: 4,
      advertiserCount: 3,
      averagePaymentCents: 3_086,
      visitCount: 368,
    }),
  );
  const homepage = String(
    homePage(config, { grossCents: 12_345, charityCents: 11_111, advertisers: [] }),
  );
  const primaryNavigation =
    homepage.match(/<nav aria-label="Primary navigation">([\s\S]*?)<\/nav>/)?.[1] || '';
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const mobileStart = styles.indexOf('@media (max-width: 760px)');
  const mobileEnd = styles.indexOf('@media (max-width: 350px)');
  const desktopGrid = styles.slice(0, mobileStart).match(/\.stats-grid\s*\{([^}]*)\}/)?.[1] || '';
  const mobileGrid = styles
    .slice(mobileStart, mobileEnd)
    .match(/\.stats-grid\s*\{([^}]*)\}/)?.[1] || '';

  assert.match(document, /<link rel="canonical" href="https:\/\/outcharity\.com\/stats"/);
  assert.equal(document.match(/class="stat-card"/g)?.length, 6);
  for (const [label, value] of [
    ['Total paid', '$123.45'],
    ['To charity', '$111.11'],
    ['Payments', '4'],
    ['Advertisers on the board', '3'],
    ['Average payment', '$30.86'],
    ['Website visits', '368'],
  ]) {
    assert.match(document, new RegExp(`${label}[\\s\\S]*?${value.replace('$', '\\$')}`), label);
  }
  assert.match(document, /Refunded or\s+disputed payments are excluded/);
  assert.match(document, /individual transactions or visits are not published/);
  assert.match(document, /Repeat payments count separately/);
  assert.match(document, /Fractional cents round in the charity&#39;s favor/);
  assert.match(document, /rounded to the nearest cent/);
  assert.match(document, /not unique people/);
  assert.match(document, /Cloudflare excludes bots; European visits are not collected/);
  assert.match(homepage, /class="campaign-stats-link" href="\/stats">See campaign stats/);
  assert.match(homepage, /<a href="\/stats">Stats<\/a>/);
  assert.equal(primaryNavigation.match(/<a /g)?.length, 4);
  assert.match(primaryNavigation, /href="\/stats">Stats<\/a>/);
  assert.match(desktopGrid, /repeat\(auto-fit,\s*minmax\(190px,\s*1fr\)\)/);
  assert.match(mobileGrid, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);

  const beforeFirstSync = String(
    statsPage(config, {
      totalPaidCents: 12_345,
      charityCents: 11_111,
      paymentCount: 4,
      advertiserCount: 3,
      averagePaymentCents: 3_086,
      visitCount: null,
    }),
  );
  assert.equal(beforeFirstSync.match(/class="stat-card"/g)?.length, 5);
  assert.doesNotMatch(beforeFirstSync, /Website visits/);
});

test('the stats route reads one D1 aggregate and is listed in the public sitemap', async () => {
  let prepareCalls = 0;
  const environment = completeEnvironment({
    DB: {
      prepare() {
        prepareCalls += 1;
        return {
          async first() {
            return {
              total_paid_cents: 1_234,
              charity_cents: 1_111,
              payment_count: 2,
              advertiser_count: 1,
              visit_count: 368,
              visit_count_updated_at: '2026-08-24T04:00:00.000Z',
            };
          },
        };
      },
    },
  });
  const response = await app.fetch(
    new Request('https://outcharity.com/stats'),
    environment,
    executionContext,
  );
  const document = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(prepareCalls, 1);
  assert.match(document, /Total paid[\s\S]*?\$12\.34/);
  assert.match(document, /To charity[\s\S]*?\$11\.11/);
  assert.match(document, /Average payment[\s\S]*?\$6\.17/);
  assert.match(document, /Website visits[\s\S]*?368/);

  const sitemapResponse = await app.fetch(
    new Request('https://outcharity.com/sitemap.xml'),
    environment,
    executionContext,
  );
  assert.equal(sitemapResponse.status, 200);
  assert.match(await sitemapResponse.text(), /<loc>https:\/\/outcharity\.com\/stats<\/loc>/);
  assert.equal(prepareCalls, 1, 'the sitemap must not query D1');
});

test('the visual refresh preserves the palette and compacts mobile leaderboard entries', () => {
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const mobileStart = styles.indexOf('@media (max-width: 760px)');
  const mobileEnd = styles.indexOf('@media (max-width: 350px)');
  const root = styles.match(/:root\s*\{([^}]*)\}/)?.[1] || '';
  const mobileStyles = styles.slice(mobileStart, mobileEnd);
  const listingCard = mobileStyles.match(/\.listing-card\s*\{([^}]*)\}/)?.[1] || '';
  const firstCard = mobileStyles.match(/\.listing-card-first\s*\{([^}]*)\}/)?.[1] || '';
  const logo = mobileStyles.match(/\.listing-logo\s*\{([^}]*)\}/)?.[1] || '';
  const firstLogo =
    mobileStyles.match(/\.listing-card-first \.listing-logo\s*\{([^}]*)\}/)?.[1] || '';
  const description = mobileStyles.match(/\.listing-copy p\s*\{([^}]*)\}/)?.[1] || '';
  const outbidLink = mobileStyles.match(/\.outbid-link\s*\{([^}]*)\}/)?.[1] || '';
  const runnerLogo =
    mobileStyles.match(/\.leader-runners \.listing-logo\s*\{([^}]*)\}/)?.[1] || '';

  for (const token of [
    '--ink: #11110f',
    '--paper: #f6f4ed',
    '--card: #fffef9',
    '--signal: #ff5c35',
    '--signal-dark: #cf3210',
    '--sun: #ffd84d',
    '--warm: #fff0e9',
    '--muted: #68665f',
    '--line: #c9c5b9',
    '--success: #166534',
    '--error: #a51d14',
  ]) {
    assert.match(root, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(listingCard, /grid-template-columns:\s*32px 44px/);
  assert.match(listingCard, /gap:\s*4px 7px/);
  assert.match(listingCard, /padding:\s*8px/);
  assert.match(firstCard, /grid-template-columns:\s*35px 50px/);
  assert.match(firstCard, /padding:\s*9px/);
  assert.match(logo, /width:\s*44px/);
  assert.match(logo, /height:\s*44px/);
  assert.match(firstLogo, /width:\s*50px/);
  assert.match(firstLogo, /height:\s*50px/);
  assert.match(description, /-webkit-line-clamp:\s*1/);
  assert.match(outbidLink, /min-height:\s*30px/);
  assert.match(
    mobileStyles,
    /\.leader-runners\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(runnerLogo, /width:\s*36px/);
  assert.match(runnerLogo, /height:\s*36px/);
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
  assert.match(document, /Founder seed - \$100 donated to kick off the board/);
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

test('outside local development only a live-mode Stripe key can open checkout', () => {
  for (const key of ['sk_test_placeholder', 'rk_test_placeholder', 'configured']) {
    const config = getConfig(completeEnvironment({ STRIPE_SECRET_KEY: key }), 'https://outcharity.com/');
    assert.equal(config.liveModeRequired, true);
    assert.equal(config.checkoutEnabled, false, key);
    assert.ok(config.issues.some((issue) => /live-mode key/.test(issue)), key);
  }
  for (const key of ['sk_live_placeholder', 'rk_live_placeholder']) {
    const config = getConfig(completeEnvironment({ STRIPE_SECRET_KEY: key }), 'https://outcharity.com/');
    assert.equal(config.checkoutEnabled, true, key);
  }
  const local = getConfig(
    completeEnvironment({ STRIPE_SECRET_KEY: 'sk_test_placeholder', SITE_URL: 'http://localhost:8787' }),
    'http://localhost:8787/',
  );
  assert.equal(local.liveModeRequired, false);
  assert.equal(local.checkoutEnabled, true);
});

test('the Terms state the hold window, finality after it, and no open-ended charity-cost promise', () => {
  const config = getConfig(completeEnvironment(), 'https://outcharity.com/');
  const terms = String(termsPage(config));
  assert.match(terms, /after a 30-day verification\s+period/);
  assert.match(terms, /Within 30 days of payment/);
  assert.match(terms, /After 30 days a payment is final/);
  assert.match(terms, /no refund is available for any reason/);
  assert.doesNotMatch(terms, /bears any charity allocation/);
  assert.doesNotMatch(terms, /Every payment requires/);
});

test('a failed Stripe session creation deletes the just-uploaded logo and reports a server error', async (context) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'Stripe is down' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  context.mock.method(console, 'error', () => {});
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const uploaded = [];
  const deleted = [];
  const environment = completeEnvironment({
    LOGOS: {
      async put(key) { uploaded.push(key); },
      async delete(key) {
        // Resolve on a later tick so only an awaited delete is recorded before the response.
        await new Promise((resolve) => setTimeout(resolve));
        deleted.push(key);
      },
    },
  });
  const form = new FormData();
  form.set('name', 'Orphan Company');
  form.set('url', 'https://example.com');
  form.set('description', 'Stripe fails after the logo is stored.');
  form.set('amount', '25');
  form.set('logo', new File([pngBytes()], 'logo.png', { type: 'image/png' }));

  const response = await app.fetch(
    new Request('https://outcharity.com/checkout', {
      method: 'POST',
      headers: { Origin: 'https://outcharity.com' },
      body: form,
    }),
    environment,
    executionContext,
  );

  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /Stripe is down/, 'provider error text stays private');
  assert.equal(response.headers.get('Set-Cookie'), null, 'no management cookie without a session');
  assert.equal(uploaded.length, 1);
  assert.deepEqual(deleted, uploaded);
});

test('one invalid submission reports every invalid field together', async () => {
  const form = new FormData();
  form.set('name', '');
  form.set('url', 'not a url');
  form.set('description', 'ok');
  form.set('amount', '0.99');
  form.set('logo', new File([new TextEncoder().encode('not an image')], 'x.png', { type: 'image/png' }));
  const response = await app.fetch(
    new Request('https://outcharity.com/checkout', {
      method: 'POST',
      headers: { Origin: 'https://outcharity.com' },
      body: form,
    }),
    completeEnvironment(),
    executionContext,
  );
  const document = await response.text();
  assert.equal(response.status, 422);
  for (const field of ['name', 'url', 'amount', 'logo']) {
    assert.match(document, new RegExp(`id="${field}-error"`), field);
  }
  assert.match(document, /Please correct the highlighted fields\./);

  // A single failing field keeps its own specific message.
  const logoOnly = new FormData();
  logoOnly.set('name', 'Acme');
  logoOnly.set('url', 'https://example.com');
  logoOnly.set('description', 'ok');
  logoOnly.set('amount', '25');
  const logoResponse = await app.fetch(
    new Request('https://outcharity.com/checkout', {
      method: 'POST',
      headers: { Origin: 'https://outcharity.com' },
      body: logoOnly,
    }),
    completeEnvironment(),
    executionContext,
  );
  const logoDocument = await logoResponse.text();
  assert.equal(logoResponse.status, 422);
  assert.match(logoDocument, /Choose a logo image\./);
  assert.doesNotMatch(logoDocument, /id="name-error"/);
});

test('an outbid link never offers less than the configured minimum contribution', () => {
  const environment = completeEnvironment({ MIN_CONTRIBUTION_CENTS: '5000' });
  const config = getConfig(environment, environment.SITE_URL);
  const document = String(
    homePage(config, {
      grossCents: 1_000,
      charityCents: 900,
      advertisers: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Legacy Listing',
          description: 'Paid before the minimum was raised.',
          url: 'https://legacy.example/',
          logo_key: 'logos/11111111-1111-4111-8111-111111111111.png',
          total_contributed_cents: 1_000,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    }),
  );
  assert.match(document, /Take #1 for \$50/);
  assert.match(document, /href="\/submit\?amount=50"/);
  assert.doesNotMatch(document, /amount=11"/);
});
