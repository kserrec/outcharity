import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  readBodyWithinLimit,
  readFormDataWithinLimit,
  requireRateLimit,
  requireSharedRateLimit,
} from '../src/http.js';
import { app } from '../src/index.js';
import {
  configuredEnvironment as launchEnvironment,
  executionContext,
  turnstileTestToken,
} from './helpers/environment.js';

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
  await requireSharedRateLimit(new Request('http://localhost/checkout'), undefined, 'checkout');
});

test('client checkout and lookup rate limits fire before request bodies, database, and storage work', async () => {
  const checkoutHooks = {};
  const checkoutKeys = [];
  const blockedCheckout = {
    async limit({ key }) {
      checkoutKeys.push(key);
      return { success: false };
    },
  };
  const lookupKeys = [];
  const blockedLookup = {
    async limit({ key }) {
      lookupKeys.push(key);
      return { success: false };
    },
  };
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
    ['homepage cache miss', 'https://outcharity.com/', { DB: rejectingDatabase }],
    ['stats cache miss', 'https://outcharity.com/stats', { DB: rejectingDatabase }],
  ]) {
    const response = await app.fetch(
      new Request(url),
      launchEnvironment({ LOOKUP_RATE_LIMITER: blockedLookup, ...overrides }),
      executionContext,
    );
    assert.equal(response.status, 429, name);
  }
  assert.deepEqual(lookupKeys, [
    'success:unknown',
    'manage:unknown',
    'logo:unknown',
    'lookup:all',
    'lookup:all',
  ]);
});

test('distributed lookup traffic hits one aggregate brake before database or storage work', async () => {
  const keys = [];
  const aggregateBlocked = {
    async limit({ key }) {
      keys.push(key);
      return { success: key !== 'lookup:all' };
    },
  };
  const environment = launchEnvironment({
    LOOKUP_RATE_LIMITER: aggregateBlocked,
    DB: { prepare() { throw new Error('D1 must not be reached'); } },
    LOGOS: { async get() { throw new Error('R2 must not be reached'); } },
  });
  const routes = [
    'https://outcharity.com/success?session_id=cs_live_12345678',
    `https://outcharity.com/manage/${'a'.repeat(64)}`,
    'https://outcharity.com/logos/11111111-1111-4111-8111-111111111111.png',
  ];

  for (const url of routes) {
    const response = await app.fetch(new Request(url), environment, executionContext);
    assert.equal(response.status, 429, url);
  }
  assert.deepEqual(keys, [
    'success:unknown',
    'lookup:all',
    'manage:unknown',
    'lookup:all',
    'logo:unknown',
    'lookup:all',
  ]);
});

test('checkout proof failures stop before database, storage, or Stripe work', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const rejectingEnvironment = launchEnvironment({
    DB: { prepare() { throw new Error('D1 must not be reached'); } },
    LOGOS: { async put() { throw new Error('R2 must not be reached'); } },
  });
  const routes = [
    ['new checkout', '/checkout'],
    ['existing checkout', `/manage/${'a'.repeat(64)}/checkout`],
  ];

  let verificationCalls = 0;
  globalThis.fetch = async () => {
    verificationCalls += 1;
    throw new Error('Turnstile must not be called without a token');
  };
  for (const [name, path] of routes) {
    const response = await app.fetch(
      new Request(`https://outcharity.com${path}`, {
        method: 'POST',
        headers: { Origin: 'https://outcharity.com' },
        body: new URLSearchParams({ amount: '25' }),
      }),
      rejectingEnvironment,
      executionContext,
    );
    assert.equal(response.status, 403, `${name} missing token`);
  }
  assert.equal(verificationCalls, 0);

  for (const [name, result] of [
    ['unsuccessful challenge', { success: false, action: 'new_checkout', hostname: 'outcharity.com' }],
    ['wrong action', { success: true, action: 'existing_checkout', hostname: 'outcharity.com' }],
    ['wrong hostname', { success: true, action: 'new_checkout', hostname: 'localhost' }],
  ]) {
    globalThis.fetch = async () => Response.json(result);
    const response = await app.fetch(
      new Request('https://outcharity.com/checkout', {
        method: 'POST',
        headers: {
          Origin: 'https://outcharity.com',
          'CF-Connecting-IP': '203.0.113.9',
        },
        body: new URLSearchParams({
          amount: '25',
          'cf-turnstile-response': turnstileTestToken,
        }),
      }),
      rejectingEnvironment,
      executionContext,
    );
    assert.equal(response.status, 403, name);
  }
});

test('invalid checkout proofs cannot consume the shared checkout brake', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const limiterKeys = [];
  const environment = launchEnvironment({
    CHECKOUT_RATE_LIMITER: {
      async limit({ key }) {
        limiterKeys.push(key);
        return { success: key !== 'checkout:all' };
      },
    },
    DB: { prepare() { throw new Error('D1 must not be reached'); } },
    LOGOS: { async put() { throw new Error('R2 must not be reached'); } },
  });
  const routes = [
    ['new_checkout', '/checkout', 'new-checkout:unknown'],
    ['existing_checkout', `/manage/${'a'.repeat(64)}/checkout`, 'existing-checkout:unknown'],
  ];

  let verificationCalls = 0;
  let currentAction = '';
  globalThis.fetch = async () => {
    verificationCalls += 1;
    return Response.json({
      success: true,
      action: currentAction,
      hostname: 'outcharity.com',
    });
  };

  for (const [, path] of routes) {
    const response = await app.fetch(
      new Request(`https://outcharity.com${path}`, {
        method: 'POST',
        headers: { Origin: 'https://outcharity.com' },
        body: new URLSearchParams({ amount: '25' }),
      }),
      environment,
      executionContext,
    );
    assert.equal(response.status, 403, path);
  }
  assert.equal(verificationCalls, 0);
  assert.deepEqual(limiterKeys, routes.map(([, , clientKey]) => clientKey));

  limiterKeys.length = 0;
  for (const [action, path] of routes) {
    currentAction = action;
    const response = await app.fetch(
      new Request(`https://outcharity.com${path}`, {
        method: 'POST',
        headers: { Origin: 'https://outcharity.com' },
        body: new URLSearchParams({
          amount: '25',
          'cf-turnstile-response': turnstileTestToken,
        }),
      }),
      environment,
      executionContext,
    );
    assert.equal(response.status, 429, path);
  }
  assert.equal(verificationCalls, 2);
  assert.deepEqual(limiterKeys, [
    'new-checkout:unknown',
    'checkout:all',
    'existing-checkout:unknown',
    'checkout:all',
  ]);
});

test('homepage share URLs revalidate downstream while sharing one five-second edge entry', async (context) => {
  const originalCaches = globalThis.caches;
  const entries = new Map();
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      default: {
        async match(request) {
          return entries.get(request.url)?.clone();
        },
        async put(request, response) {
          entries.set(request.url, response.clone());
        },
      },
    },
  });
  context.after(() => {
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: originalCaches,
    });
  });

  const limiterKeys = [];
  const environment = launchEnvironment({
    DB: null,
    LOOKUP_RATE_LIMITER: {
      async limit({ key }) {
        limiterKeys.push(key);
        return { success: true };
      },
    },
  });

  for (const url of [
    'https://outcharity.com/?share=give-and-grow-20260825',
    'https://outcharity.com/',
  ]) {
    const response = await app.fetch(new Request(url), environment, executionContext);
    const document = await response.text();
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('Cache-Control'),
      'public, no-cache, max-age=0, must-revalidate',
    );
    assert.match(document, /content="https:\/\/outcharity\.com\/og-3ed4f5f4\.png"/);
  }

  assert.deepEqual(limiterKeys, ['lookup:all']);
  assert.deepEqual([...entries.keys()], ['https://outcharity.com/']);
  assert.equal(
    entries.get('https://outcharity.com/').headers.get('Cache-Control'),
    'public, max-age=5, s-maxage=5, must-revalidate',
  );
});

test('stats query variations share one cache entry and one database read', async (context) => {
  const originalCaches = globalThis.caches;
  const entries = new Map();
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      default: {
        async match(request) {
          return entries.get(request.url)?.clone();
        },
        async put(request, response) {
          entries.set(request.url, response.clone());
        },
      },
    },
  });
  context.after(() => {
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: originalCaches,
    });
  });

  let databaseReads = 0;
  const limiterKeys = [];
  const environment = launchEnvironment({
    LOOKUP_RATE_LIMITER: {
      async limit({ key }) {
        limiterKeys.push(key);
        return { success: true };
      },
    },
    DB: {
      prepare() {
        databaseReads += 1;
        return {
          async first() {
            return {};
          },
        };
      },
    },
  });

  for (const query of ['?source=one', '?source=two', '?ignored=three']) {
    const response = await app.fetch(
      new Request(`https://outcharity.com/stats${query}`),
      environment,
      executionContext,
    );
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('Cache-Control'),
      'public, no-cache, max-age=0, must-revalidate',
    );
  }

  assert.equal(databaseReads, 1);
  assert.deepEqual(limiterKeys, ['lookup:all']);
  assert.deepEqual([...entries.keys()], ['https://outcharity.com/stats']);
  assert.equal(
    entries.get('https://outcharity.com/stats').headers.get('Cache-Control'),
    'public, max-age=5, s-maxage=5, must-revalidate',
  );
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
  assert.equal(canonicalResponse.headers.get('Referrer-Policy'), 'same-origin');
  assert.match(
    canonicalResponse.headers.get('Content-Security-Policy'),
    /script-src 'self' https:\/\/static\.cloudflareinsights\.com https:\/\/challenges\.cloudflare\.com(?:;|$)/,
  );
  assert.match(
    canonicalResponse.headers.get('Content-Security-Policy'),
    /frame-src https:\/\/challenges\.cloudflare\.com(?:;|$)/,
  );
  assert.doesNotMatch(
    canonicalResponse.headers.get('Content-Security-Policy'),
    /script-src[^;]*\*/,
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
  assert.equal(wrangler.limits, undefined, 'Workers Free rejects custom CPU limits');
  // Management links carry their credential in the URL; per-request invocation logs would
  // record those URLs, so only the Worker's own console output may be collected.
  assert.equal(wrangler.observability?.logs?.invocation_logs, false);

  const staticHeaders = readFileSync(
    new URL('../public/_headers', import.meta.url),
    'utf8',
  );
  assert.match(staticHeaders, /^https:\/\/outcharity\.com\/\*/m);
  assert.match(staticHeaders, /Strict-Transport-Security: max-age=31536000/);
  assert.match(staticHeaders, /X-Content-Type-Options: nosniff/);
  assert.match(staticHeaders, /Referrer-Policy: same-origin/);
  assert.match(
    staticHeaders,
    /script-src 'self' https:\/\/static\.cloudflareinsights\.com https:\/\/challenges\.cloudflare\.com(?:;|$)/,
  );
  assert.match(staticHeaders, /frame-src https:\/\/challenges\.cloudflare\.com(?:;|$)/);
  assert.doesNotMatch(staticHeaders, /script-src[^;]*\*/);
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
  const limiterKeys = [];
  const env = launchEnvironment({
    LOOKUP_RATE_LIMITER: {
      async limit({ key }) {
        limiterKeys.push(key);
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
  assert.deepEqual(limiterKeys, ['logo:unknown', 'lookup:all']);
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

test('rate limiting buckets an IPv6 client by its /64 block and keeps IPv4 exact', async () => {
  const keys = [];
  const limiter = { async limit({ key }) { keys.push(key); return { success: true }; } };
  const addresses = [
    '2001:db8:abcd:1234::1',
    '2001:db8:abcd:1234::2',
    '2001:DB8:ABCD:1234:ffff:ffff:ffff:ffff',
    '2001:0db8:abcd:1234:0000:0000:0000:0003',
    '2001:db8:abcd:1234:5::',
    '2001:db8:abcd:1235::1',
    '203.0.113.9',
    '203.0.113.10',
    '::ffff:203.0.113.9',
    '1::2::3',
    '',
    'garbage::zz',
  ];
  for (const address of addresses) {
    await requireRateLimit(
      new Request('https://outcharity.com/probe', { headers: { 'CF-Connecting-IP': address } }),
      limiter,
      'probe',
    );
  }
  assert.deepEqual(keys, [
    'probe:2001:0db8:abcd:1234::/64',
    'probe:2001:0db8:abcd:1234::/64',
    'probe:2001:0db8:abcd:1234::/64',
    'probe:2001:0db8:abcd:1234::/64',
    'probe:2001:0db8:abcd:1234::/64',
    'probe:2001:0db8:abcd:1235::/64',
    'probe:203.0.113.9',
    'probe:203.0.113.10',
    'probe:203.0.113.9',
    'probe:invalid',
    'probe:unknown',
    'probe:invalid',
  ]);
});

test('unreadable or wrongly typed form bodies are refused with 400, not a server error', async (context) => {
  const errors = context.mock.method(console, 'error', () => {});
  const environment = launchEnvironment();
  const cases = [
    { 'Content-Type': 'application/json', body: '{"name":"x"}' },
    { 'Content-Type': 'text/plain', body: 'name=x' },
    { 'Content-Type': 'multipart/form-data; boundary=zz', body: 'not multipart at all' },
    { 'Content-Type': 'multipart/form-data', body: '--x\r\n' },
    { body: 'name=x' },
  ];
  for (const { body, ...headers } of cases) {
    const response = await app.request(
      'https://outcharity.com/checkout',
      { method: 'POST', headers: { Origin: 'https://outcharity.com', ...headers }, body },
      environment,
      executionContext,
    );
    assert.equal(response.status, 400, JSON.stringify(headers));
  }
  assert.equal(errors.mock.callCount(), 0);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    success: true,
    action: 'existing_checkout',
    hostname: 'outcharity.com',
  });
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const urlEncoded = await app.request(
    'https://outcharity.com/manage/aa'.padEnd(31 + 64, 'a') + '/checkout',
    {
      method: 'POST',
      headers: { Origin: 'https://outcharity.com', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        amount: '10',
        'cf-turnstile-response': turnstileTestToken,
      }),
    },
    { ...environment, DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } },
    executionContext,
  );
  assert.equal(urlEncoded.status, 404, 'url-encoded bodies still parse');
});

test('form posts from another site or with no Origin are refused before any downstream work', async () => {
  const environment = launchEnvironment({
    DB: { prepare() { throw new Error('the database must not be reached'); } },
    LOGOS: { async put() { throw new Error('R2 must not be reached'); } },
    CHECKOUT_RATE_LIMITER: { async limit() { throw new Error('rate limiting must not run'); } },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Stripe must not be reached'); };
  try {
    for (const path of ['/checkout', `/manage/${'a'.repeat(64)}/checkout`]) {
      for (const origin of [
        'https://evil.example',
        'http://outcharity.com',
        'https://outcharity.com.evil.example',
        'https://outcharity.com:8443',
        'https://www.outcharity.com',
        'null',
        undefined,
      ]) {
        const response = await app.fetch(
          postRequest(`https://outcharity.com${path}`, [20], {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(origin === undefined ? {} : { Origin: origin }),
          }),
          environment,
          executionContext,
        );
        // The environment throws on any database, storage, limiter, or Stripe use, so a 403
        // (rather than a 500) proves the request was refused before downstream work.
        assert.equal(response.status, 403, `${path} Origin=${origin}`);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
