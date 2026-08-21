import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  readBodyWithinLimit,
  readFormDataWithinLimit,
  requireRateLimit,
} from '../src/http.js';
import { app } from '../src/index.js';

function requestStream(byteCounts, hooks = {}) {
  const chunks = byteCounts.map((count) => new Uint8Array(count).fill(97));
  return new ReadableStream({
    pull(controller) {
      hooks.pulled = true;
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      hooks.cancelled = true;
    },
  });
}

function postRequest(url, byteCounts, headers = {}, hooks = {}) {
  return new Request(url, {
    method: 'POST',
    headers,
    body: requestStream(byteCounts, hooks),
    duplex: 'half',
  });
}

function launchEnvironment(overrides = {}) {
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
    CHECKOUT_RATE_LIMITER: { async limit() { return { success: true }; } },
    LOOKUP_RATE_LIMITER: { async limit() { return { success: true }; } },
    ...overrides,
  };
}

const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
};

test('the bounded body reader enforces actual streamed bytes, not just Content-Length', async () => {
  const exact = postRequest('https://outcharity.com/probe', [4, 6]);
  assert.equal((await readBodyWithinLimit(exact, 10)).byteLength, 10);

  const fragmented = postRequest(
    'https://outcharity.com/probe',
    Array.from({ length: 1_000 }, () => 1),
  );
  assert.equal((await readBodyWithinLimit(fragmented, 1_000)).byteLength, 1_000);

  const oversizedHooks = {};
  const oversized = postRequest(
    'https://outcharity.com/probe',
    [6, 5],
    {},
    oversizedHooks,
  );
  await assert.rejects(readBodyWithinLimit(oversized, 10), { status: 413 });
  assert.equal(oversizedHooks.cancelled, true);

  for (const contentLength of ['11', 'not-a-number']) {
    const hooks = {};
    const declaredOversized = postRequest(
      'https://outcharity.com/probe',
      [1],
      { 'Content-Length': contentLength },
      hooks,
    );
    await assert.rejects(readBodyWithinLimit(declaredOversized, 10), { status: 413 });
    assert.equal(hooks.cancelled, true, contentLength);
  }
});

test('bounded multipart parsing preserves ordinary fields and uploaded files', async () => {
  const submitted = new FormData();
  submitted.set('name', 'Acme');
  submitted.set(
    'logo',
    new File([Uint8Array.from([137, 80, 78, 71])], 'logo.png', { type: 'image/png' }),
  );
  const request = new Request('https://outcharity.com/checkout', {
    method: 'POST',
    body: submitted,
  });

  const parsed = await readFormDataWithinLimit(request, 1024);
  assert.equal(parsed.get('name'), 'Acme');
  const logo = parsed.get('logo');
  assert.equal(logo.name, 'logo.png');
  assert.equal(logo.type, 'image/png');
  assert.deepEqual(new Uint8Array(await logo.arrayBuffer()), Uint8Array.from([137, 80, 78, 71]));
});

test('every public write route rejects an undeclared oversized body before downstream work', async () => {
  const originHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: 'https://outcharity.com',
  };
  const rejectingDatabase = {
    prepare() {
      throw new Error('the database must not be reached');
    },
  };

  const cases = [
    {
      name: 'new checkout',
      request: postRequest(
        'https://outcharity.com/checkout',
        [700 * 1024, 1],
        originHeaders,
      ),
      env: launchEnvironment({ DB: rejectingDatabase }),
    },
    {
      name: 'existing advertiser checkout',
      request: postRequest(
        `https://outcharity.com/manage/${'a'.repeat(64)}/checkout`,
        [16 * 1024 + 1],
        originHeaders,
      ),
      env: launchEnvironment({ DB: rejectingDatabase }),
    },
    {
      name: 'Stripe webhook',
      request: postRequest(
        'https://outcharity.com/webhooks/stripe',
        [512 * 1024, 512 * 1024, 1],
        { 'stripe-signature': 'invalid' },
      ),
      env: launchEnvironment(),
    },
  ];

  for (const { name, request, env } of cases) {
    const response = await app.fetch(request, env, executionContext);
    assert.equal(response.status, 413, name);
    assert.ok((await response.text()).length < 10_000, name);
  }
});

test('rate limiting fails closed in production and cannot be bypassed by omitting an IP header', async () => {
  const keys = [];
  const blocked = {
    async limit({ key }) {
      keys.push(key);
      return { success: false };
    },
  };

  await assert.rejects(
    requireRateLimit(
      new Request('https://outcharity.com/success'),
      blocked,
      'success',
    ),
    { status: 429 },
  );
  assert.deepEqual(keys, ['success:unknown']);
  await assert.rejects(
    requireRateLimit(new Request('https://outcharity.com/success'), undefined, 'success'),
    { status: 503 },
  );
  await requireRateLimit(new Request('http://localhost/success'), undefined, 'success');
});

test('rate limits fire before checkout, database, and storage work', async () => {
  const checkoutHooks = {};
  const checkoutKeys = [];
  const blockedCheckout = {
    async limit({ key }) {
      checkoutKeys.push(key);
      return { success: false };
    },
  };
  const blockedLookup = { async limit() { return { success: false }; } };
  const rejectingDatabase = {
    prepare() {
      throw new Error('the database must not be reached');
    },
  };
  const rejectingStorage = {
    async get() {
      throw new Error('R2 must not be reached');
    },
  };

  const checkoutResponse = await app.fetch(
    postRequest(
      'https://outcharity.com/checkout',
      [20],
      {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://outcharity.com',
      },
      checkoutHooks,
    ),
    launchEnvironment({ CHECKOUT_RATE_LIMITER: blockedCheckout }),
    executionContext,
  );
  assert.equal(checkoutResponse.status, 429);
  assert.equal(checkoutHooks.cancelled, true);

  const existingCheckoutHooks = {};
  const existingCheckoutResponse = await app.fetch(
    postRequest(
      `https://outcharity.com/manage/${'a'.repeat(64)}/checkout`,
      [20],
      {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://outcharity.com',
      },
      existingCheckoutHooks,
    ),
    launchEnvironment({
      CHECKOUT_RATE_LIMITER: blockedCheckout,
      DB: rejectingDatabase,
    }),
    executionContext,
  );
  assert.equal(existingCheckoutResponse.status, 429);
  assert.equal(existingCheckoutHooks.cancelled, true);
  assert.deepEqual(checkoutKeys, [
    'new-checkout:unknown',
    'existing-checkout:unknown',
  ]);

  for (const [name, url, overrides] of [
    [
      'success lookup',
      'https://outcharity.com/success?session_id=cs_test_12345678',
      { DB: rejectingDatabase },
    ],
    [
      'management lookup',
      `https://outcharity.com/manage/${'a'.repeat(64)}`,
      { DB: rejectingDatabase },
    ],
    [
      'logo cache miss',
      'https://outcharity.com/logos/11111111-1111-4111-8111-111111111111.png',
      { LOGOS: rejectingStorage },
    ],
  ]) {
    const response = await app.fetch(
      new Request(url),
      launchEnvironment({ LOOKUP_RATE_LIMITER: blockedLookup, ...overrides }),
      executionContext,
    );
    assert.equal(response.status, 429, name);
  }
});

test('the public health endpoint performs no database work', async () => {
  const response = await app.fetch(
    new Request('https://outcharity.com/health'),
    launchEnvironment({
      DB: {
        prepare() {
          throw new Error('health must not query D1');
        },
      },
    }),
    executionContext,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, checkoutEnabled: true });
});

test('production requests use only the configured HTTPS origin', async () => {
  for (const source of [
    'http://outcharity.com/submit?amount=25',
    'https://outcharity.example/submit?amount=25',
  ]) {
    const response = await app.fetch(
      new Request(source),
      launchEnvironment(),
      executionContext,
    );
    assert.equal(response.status, 308, source);
    assert.equal(
      response.headers.get('Location'),
      'https://outcharity.com/submit?amount=25',
      source,
    );
    assert.equal(
      response.headers.get('Strict-Transport-Security'),
      'max-age=31536000',
      source,
    );
  }

  for (const [source, expected] of [
    [
      'http://outcharity.com//evil.example/phish',
      'https://outcharity.com//evil.example/phish',
    ],
    [
      'http://outcharity.com////evil.example/phish?from=test',
      'https://outcharity.com////evil.example/phish?from=test',
    ],
    [
      'http://outcharity.com/%2f%2fevil.example/phish',
      'https://outcharity.com/%2f%2fevil.example/phish',
    ],
  ]) {
    const response = await app.fetch(
      new Request(source),
      launchEnvironment(),
      executionContext,
    );
    assert.equal(response.status, 308, source);
    assert.equal(response.headers.get('Location'), expected, source);
    assert.equal(new URL(response.headers.get('Location')).origin, 'https://outcharity.com');
  }

  const rejectedHooks = {};
  const rejectedPost = await app.fetch(
    postRequest(
      'http://outcharity.com/checkout',
      [20],
      { Origin: 'http://outcharity.com' },
      rejectedHooks,
    ),
    launchEnvironment(),
    executionContext,
  );
  assert.equal(rejectedPost.status, 421);
  assert.equal(rejectedHooks.cancelled, true);

  for (const siteUrl of ['', 'http://localhost:8787', 'http://outcharity.com']) {
    const response = await app.fetch(
      new Request('https://outcharity.com/submit'),
      launchEnvironment({ SITE_URL: siteUrl }),
      executionContext,
    );
    assert.equal(response.status, 503, JSON.stringify(siteUrl));
    assert.equal(
      response.headers.get('Strict-Transport-Security'),
      'max-age=31536000',
      JSON.stringify(siteUrl),
    );
  }

  const canonicalResponse = await app.fetch(
    new Request('https://outcharity.com/submit'),
    launchEnvironment(),
    executionContext,
  );
  assert.equal(canonicalResponse.status, 200);
  assert.equal(
    canonicalResponse.headers.get('Strict-Transport-Security'),
    'max-age=31536000',
  );
});

test('deployment disables alternate public hosts and hardens static assets', () => {
  const wrangler = JSON.parse(
    readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
  );
  assert.equal(wrangler.workers_dev, false);
  assert.equal(wrangler.preview_urls, false);
  assert.deepEqual(wrangler.routes, [
    { pattern: 'outcharity.com', custom_domain: true },
  ]);
  assert.deepEqual(wrangler.triggers?.crons, ['*/15 * * * *']);

  const staticHeaders = readFileSync(
    new URL('../public/_headers', import.meta.url),
    'utf8',
  );
  assert.match(staticHeaders, /^https:\/\/outcharity\.com\/\*/m);
  assert.match(staticHeaders, /Strict-Transport-Security: max-age=31536000/);
  assert.match(staticHeaders, /X-Content-Type-Options: nosniff/);
  assert.match(staticHeaders, /Referrer-Policy: no-referrer/);
});

test('logo query variations share one cache entry and one storage read', async (context) => {
  const originalCaches = globalThis.caches;
  const entries = new Map();
  const cache = {
    async match(request) {
      return entries.get(request.url)?.clone();
    },
    async put(request, response) {
      entries.set(request.url, response.clone());
    },
  };
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: { default: cache },
  });
  context.after(() => {
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: originalCaches,
    });
  });

  let storageReads = 0;
  let databaseReads = 0;
  let limiterCalls = 0;
  const env = launchEnvironment({
    LOOKUP_RATE_LIMITER: {
      async limit() {
        limiterCalls += 1;
        return { success: true };
      },
    },
    LOGOS: {
      async get() {
        storageReads += 1;
        return {
          body: new Uint8Array([137, 80, 78, 71]),
          httpMetadata: { contentType: 'image/png' },
          httpEtag: 'test-etag',
        };
      },
    },
    DB: {
      prepare() {
        databaseReads += 1;
        return {
          bind() {
            return this;
          },
          async first() {
            return { visible: 1 };
          },
        };
      },
    },
  });
  const logoPath = '/logos/11111111-1111-4111-8111-111111111111.png';

  for (const query of ['?v=one', '?v=two', '?ignored=three']) {
    const response = await app.fetch(
      new Request(`https://outcharity.com${logoPath}${query}`),
      env,
      executionContext,
    );
    assert.equal(response.status, 200);
  }

  for (const encodedPath of [
    '/logos/%31%31%31%31%31%31%31%31-1111-4111-8111-111111111111.png',
    '/logos/11111111-1111-4111-8111-111111111111%2epng',
    '/logos/11111111-1111-4111-8111-111111111111.%70%6e%67',
  ]) {
    const response = await app.fetch(
      new Request(`https://outcharity.com${encodedPath}`),
      env,
      executionContext,
    );
    assert.equal(response.status, 404, encodedPath);
  }

  assert.equal(storageReads, 1);
  assert.equal(databaseReads, 1);
  assert.equal(limiterCalls, 1);
  assert.deepEqual([...entries.keys()], [`https://outcharity.com${logoPath}`]);
});

test('unconfirmed or hidden logos are not served and visible-logo caching is revocable', async () => {
  let storageReads = 0;
  const hiddenEnvironment = launchEnvironment({
    DB: {
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
    },
    LOGOS: {
      async get() {
        storageReads += 1;
        return null;
      },
    },
  });
  const logoUrl =
    'https://outcharity.com/logos/22222222-2222-4222-8222-222222222222.png';
  const hiddenResponse = await app.fetch(
    new Request(logoUrl),
    hiddenEnvironment,
    executionContext,
  );
  assert.equal(hiddenResponse.status, 404);
  assert.equal(storageReads, 0);

  const visibleEnvironment = launchEnvironment({
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            return { visible: 1 };
          },
        };
      },
    },
    LOGOS: {
      async get() {
        storageReads += 1;
        return {
          body: new Uint8Array([137, 80, 78, 71]),
          httpMetadata: { contentType: 'image/png' },
          httpEtag: 'visible-etag',
        };
      },
    },
  });
  const visibleResponse = await app.fetch(
    new Request(logoUrl),
    visibleEnvironment,
    executionContext,
  );
  assert.equal(visibleResponse.status, 200);
  assert.equal(
    visibleResponse.headers.get('Cache-Control'),
    'public, max-age=60, s-maxage=60, must-revalidate',
  );
  assert.doesNotMatch(visibleResponse.headers.get('Cache-Control'), /immutable|31536000/);
});
