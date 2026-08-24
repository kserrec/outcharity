import { getWebAnalyticsLastSuccess, recordWebAnalyticsDays } from './db.js';

const ANALYTICS_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REFRESH_AFTER_MILLISECONDS = 55 * 60 * 1000;
const REFRESH_LOOKBACK_DAYS = 7;
const REQUEST_TIMEOUT_MILLISECONDS = 10_000;

const VISITS_QUERY = `query OutcharityVisits(
  $accountTag: string!
  $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      visits: rumPageloadEventsAdaptiveGroups(
        filter: $filter
        limit: 16
        orderBy: [date_ASC]
      ) {
        dimensions {
          date
        }
        sum {
          visits
        }
      }
    }
  }
}`;

function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

function shiftUtcDay(day, offset) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return utcDay(date);
}

function daysBetween(start, end) {
  const days = [];
  for (let day = start; day <= end; day = shiftUtcDay(day, 1)) days.push(day);
  return days;
}

function isUtcDay(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && utcDay(date) === value;
}

function analyticsConfiguration(env) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env.CLOUDFLARE_ANALYTICS_TOKEN || '').trim();
  const firstDay = String(env.WEB_ANALYTICS_START_DATE || '').trim();
  const baselineSource = String(env.WEB_ANALYTICS_BASELINE_VISITS || '').trim();
  const baselineVisits = /^\d+$/.test(baselineSource) ? Number(baselineSource) : NaN;
  let hostname = '';
  try {
    hostname = new URL(String(env.SITE_URL || '')).hostname;
  } catch {
    // An invalid production origin is already reported by the main application configuration.
  }

  if (
    !env.DB ||
    !ACCOUNT_ID_PATTERN.test(accountId) ||
    !token ||
    !isUtcDay(firstDay) ||
    !Number.isSafeInteger(baselineVisits) ||
    !hostname
  ) {
    return null;
  }
  return { accountId, baselineVisits, firstDay, hostname, token };
}

function safeVisitCount(value) {
  const count = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Cloudflare analytics returned an invalid visit count.');
  }
  return count;
}

function parseDailyVisits(payload, requestedDays) {
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    const detail = payload.errors
      .map((error) => String(error?.message || 'unknown query error'))
      .join('; ')
      .slice(0, 500);
    throw new Error(`Cloudflare analytics query failed: ${detail}`);
  }

  const accounts = payload?.data?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1 || !Array.isArray(accounts[0]?.visits)) {
    throw new Error('Cloudflare analytics returned an unexpected response.');
  }

  const allowedDays = new Set(requestedDays);
  const counts = new Map(requestedDays.map((day) => [day, 0]));
  const seenDays = new Set();
  for (const row of accounts[0].visits) {
    const day = String(row?.dimensions?.date || '');
    if (!allowedDays.has(day) || !DATE_PATTERN.test(day) || !row?.sum) {
      throw new Error('Cloudflare analytics returned an unexpected daily row.');
    }
    if (seenDays.has(day)) {
      throw new Error('Cloudflare analytics returned a duplicate daily row.');
    }
    seenDays.add(day);
    counts.set(day, safeVisitCount(row.sum.visits));
  }
  return requestedDays.map((day) => ({ day, visits: counts.get(day) }));
}

function isRecent(lastSuccessAt, now) {
  if (!lastSuccessAt) return false;
  const timestamp = Date.parse(lastSuccessAt);
  return Number.isFinite(timestamp) && now.getTime() - timestamp < REFRESH_AFTER_MILLISECONDS;
}

export async function syncCloudflareVisits(env, fetcher = fetch, { force = false, now = new Date() } = {}) {
  const config = analyticsConfiguration(env);
  if (!config) return { synced: false, reason: 'unconfigured' };
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Analytics sync time must be a valid Date.');
  }

  const lastSuccessAt = await getWebAnalyticsLastSuccess(env.DB);
  if (!force && isRecent(lastSuccessAt, now)) {
    return { synced: false, reason: 'fresh' };
  }

  const endDay = utcDay(now);
  const lookbackDay = shiftUtcDay(endDay, -REFRESH_LOOKBACK_DAYS);
  const startDay = config.firstDay > lookbackDay ? config.firstDay : lookbackDay;
  if (startDay > endDay) return { synced: false, reason: 'before-start' };
  const requestedDays = daysBetween(startDay, endDay);

  const response = await fetcher(ANALYTICS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: VISITS_QUERY,
      variables: {
        accountTag: config.accountId,
        filter: {
          bot: 0,
          date_geq: startDay,
          date_leq: endDay,
          requestHost: config.hostname,
        },
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  });
  if (!response.ok) {
    throw new Error(`Cloudflare analytics request failed with HTTP ${response.status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Cloudflare analytics returned unreadable JSON.');
  }
  const days = parseDailyVisits(payload, requestedDays);
  const visitCount = days.reduce((total, day) => total + day.visits, 0);
  if (!lastSuccessAt && visitCount < config.baselineVisits) {
    throw new Error('Cloudflare analytics returned fewer visits than the verified launch baseline.');
  }
  const fetchedAt = now.toISOString();
  await recordWebAnalyticsDays(env.DB, days, fetchedAt);
  return {
    synced: true,
    days: days.length,
    visits: visitCount,
  };
}
