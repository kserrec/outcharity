import assert from 'node:assert/strict';
import test from 'node:test';

import { syncCloudflareVisits } from '../src/analytics.js';
import { getLeaderboard, getPublicStats, getWebAnalyticsLastSuccess } from '../src/db.js';
import { TestD1Database } from './helpers/d1.js';

function analyticsEnvironment(db, overrides = {}) {
  return {
    DB: db,
    SITE_URL: 'https://outcharity.com',
    CLOUDFLARE_ACCOUNT_ID: '82901762bf678507dc432f37e1bcb440',
    CLOUDFLARE_ANALYTICS_TOKEN: 'private-test-token',
    WEB_ANALYTICS_START_DATE: '2026-08-21',
    WEB_ANALYTICS_BASELINE_VISITS: '368',
    ...overrides,
  };
}

test('analytics sync stores only bot-filtered daily visit totals and preserves zero days', async (context) => {
  const db = new TestD1Database();
  context.after(() => db.close());
  const now = new Date('2026-08-24T04:00:00.000Z');
  let requestBody;

  const result = await syncCloudflareVisits(
    analyticsEnvironment(db),
    async (url, init) => {
      assert.equal(url, 'https://api.cloudflare.com/client/v4/graphql');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer private-test-token');
      assert.ok(init.signal instanceof AbortSignal);
      requestBody = JSON.parse(init.body);
      return Response.json({
        data: {
          viewer: {
            accounts: [
              {
                visits: [
                  { dimensions: { date: '2026-08-21' }, sum: { visits: 100 } },
                  { dimensions: { date: '2026-08-23' }, sum: { visits: 120 } },
                  { dimensions: { date: '2026-08-24' }, sum: { visits: 148 } },
                ],
              },
            ],
          },
        },
      });
    },
    { force: true, now },
  );

  assert.match(requestBody.query, /rumPageloadEventsAdaptiveGroups/);
  assert.match(requestBody.query, /sum\s*\{\s*visits/);
  assert.deepEqual(requestBody.variables, {
    accountTag: '82901762bf678507dc432f37e1bcb440',
    filter: {
      bot: 0,
      date_geq: '2026-08-21',
      date_leq: '2026-08-24',
      requestHost: 'outcharity.com',
    },
  });
  assert.doesNotMatch(JSON.stringify(requestBody), /private-test-token/);
  assert.deepEqual(result, { synced: true, days: 4, visits: 368 });
  const stored = await db.prepare('SELECT day, visits FROM web_analytics_daily ORDER BY day').all();
  assert.deepEqual(stored.results.map((row) => ({ ...row })), [
    { day: '2026-08-21', visits: 100 },
    { day: '2026-08-22', visits: 0 },
    { day: '2026-08-23', visits: 120 },
    { day: '2026-08-24', visits: 148 },
  ]);
  assert.equal(await getWebAnalyticsLastSuccess(db), now.toISOString());
  assert.equal((await getPublicStats(db)).visitCount, 368);
  assert.equal((await getLeaderboard(db)).visitCount, 368);
});

test('a recent successful sync prevents another Cloudflare request', async (context) => {
  const db = new TestD1Database();
  context.after(() => db.close());
  const firstNow = new Date('2026-08-24T04:00:00.000Z');

  await syncCloudflareVisits(
    analyticsEnvironment(db, { WEB_ANALYTICS_BASELINE_VISITS: '0' }),
    async () => Response.json({ data: { viewer: { accounts: [{ visits: [] }] } } }),
    { force: true, now: firstNow },
  );
  const result = await syncCloudflareVisits(
    analyticsEnvironment(db),
    async () => {
      throw new Error('fresh data must not be fetched again');
    },
    { now: new Date('2026-08-24T04:30:00.000Z') },
  );

  assert.deepEqual(result, { synced: false, reason: 'fresh' });
});

test('an analytics API failure cannot replace the last successful totals', async (context) => {
  const db = new TestD1Database();
  context.after(() => db.close());
  const env = analyticsEnvironment(db);
  const firstNow = new Date('2026-08-24T04:00:00.000Z');

  await syncCloudflareVisits(
    env,
    async () =>
      Response.json({
        data: {
          viewer: {
            accounts: [
              {
                visits: [{ dimensions: { date: '2026-08-24' }, sum: { visits: 368 } }],
              },
            ],
          },
        },
      }),
    { force: true, now: firstNow },
  );

  await assert.rejects(
    syncCloudflareVisits(env, async () => new Response('denied', { status: 403 }), {
      force: true,
      now: new Date('2026-08-24T05:00:00.000Z'),
    }),
    /HTTP 403/,
  );
  assert.equal(await getWebAnalyticsLastSuccess(db), firstNow.toISOString());
  assert.equal((await getPublicStats(db)).visitCount, 368);
});

test('analytics sync is inert when its read-only integration is not configured', async () => {
  const result = await syncCloudflareVisits(
    {},
    async () => {
      throw new Error('unconfigured analytics must not make a request');
    },
  );
  assert.deepEqual(result, { synced: false, reason: 'unconfigured' });
});

test('the first sync refuses data below the verified 368-visit launch baseline', async (context) => {
  const db = new TestD1Database();
  context.after(() => db.close());

  await assert.rejects(
    syncCloudflareVisits(
      analyticsEnvironment(db),
      async () =>
        Response.json({
          data: {
            viewer: {
              accounts: [
                {
                  visits: [{ dimensions: { date: '2026-08-24' }, sum: { visits: 367 } }],
                },
              ],
            },
          },
        }),
      { force: true, now: new Date('2026-08-24T04:00:00.000Z') },
    ),
    /fewer visits than the verified launch baseline/,
  );
  assert.equal(await getWebAnalyticsLastSuccess(db), null);
  assert.equal((await getPublicStats(db)).visitCount, null);
});
