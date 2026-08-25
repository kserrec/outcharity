import { isLocalHostname } from './http.js';

const DEFAULT_SITE_URL = 'http://localhost:8787';
const V1_CHARITY_PERCENTAGE = 90;
const V1_PLATFORM_PERCENTAGE = 10;
const STRIPE_MINIMUM_USD_CENTS = 50;
const STRIPE_MAXIMUM_USD_CENTS = 99_999_999;
const DEFAULT_CHARITY_HOLD_DAYS = 30;
const MAX_CHARITY_HOLD_DAYS = 365;
const LOCAL_TURNSTILE_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
const TURNSTILE_ACTIONS = Object.freeze({
  newCheckout: 'new_checkout',
  existingCheckout: 'existing_checkout',
});

// The single reading of CHARITY_HOLD_DAYS shared by the Terms page and the scheduled delivery
// task, so what the public is told and what the cron does can never diverge. Anything outside
// 0 through 365 whole days falls back to the default hold rather than to an immediate send.
export function charityHoldDays(env) {
  return parseCharityHoldDays(env).days;
}

function parseCharityHoldDays(env) {
  const source = String(env.CHARITY_HOLD_DAYS ?? '');
  if (source === '') return { days: DEFAULT_CHARITY_HOLD_DAYS, valid: true };
  const days = /^\d{1,3}$/.test(source) ? Number(source) : NaN;
  if (days <= MAX_CHARITY_HOLD_DAYS) return { days, valid: true };
  return { days: DEFAULT_CHARITY_HOLD_DAYS, valid: false };
}

function readInteger(value, fallback, name, issues) {
  const source = value === undefined || value === '' ? String(fallback) : String(value);
  if (!/^\d+$/.test(source)) {
    issues.push(`${name} must be a whole number.`);
    return fallback;
  }

  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed)) {
    issues.push(`${name} is outside the supported range.`);
    return fallback;
  }

  return parsed;
}

function parseWebUrl(value, name, issues, { requireHttps = false } = {}) {
  try {
    const parsed = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
      throw new Error('invalid web URL');
    }
    if (requireHttps && parsed.protocol !== 'https:') {
      throw new Error('HTTPS required');
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    issues.push(`${name} must be a valid${requireHttps ? ' HTTPS' : ''} URL.`);
    return '';
  }
}

function isLocalUrl(value) {
  try {
    return isLocalHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

function getTurnstileConfig(env, requestOrigin) {
  const requestHostname = new URL(requestOrigin).hostname;
  const siteKey = String(env.TURNSTILE_SITE_KEY || '').trim();
  const configuredHostnames = [
    ...new Set(
      String(env.TURNSTILE_HOSTNAMES || '')
        .split(',')
        .map((hostname) => hostname.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  let hostnames = [];
  if (isLocalUrl(requestOrigin)) {
    if (LOCAL_TURNSTILE_HOSTNAMES.has(requestHostname)) hostnames = [requestHostname];
  } else if (
    configuredHostnames.length === 1 &&
    configuredHostnames[0] === requestHostname &&
    !isLocalHostname(configuredHostnames[0])
  ) {
    hostnames = configuredHostnames;
  }

  return {
    siteKey,
    hostnames,
    actions: TURNSTILE_ACTIONS,
    configured: Boolean(
      /^\S{1,256}$/.test(siteKey) &&
        typeof env.TURNSTILE_SECRET === 'string' &&
        /^\S+$/.test(env.TURNSTILE_SECRET) &&
        hostnames.length > 0
    ),
  };
}

export function getConfig(env, requestUrl = DEFAULT_SITE_URL) {
  const issues = [];
  const requestOrigin = new URL(requestUrl).origin;
  const siteUrlSource = env.SITE_URL || (isLocalUrl(requestOrigin) ? requestOrigin : '');
  let siteUrl = parseWebUrl(siteUrlSource, 'SITE_URL', issues);
  if (siteUrl) {
    const parsedSiteUrl = new URL(siteUrl);
    if (parsedSiteUrl.pathname !== '/' || parsedSiteUrl.search || parsedSiteUrl.hash) {
      issues.push('SITE_URL must be an origin without a path, query, or fragment.');
    }
    siteUrl = parsedSiteUrl.origin;
  }
  if (siteUrl && !isLocalUrl(siteUrl) && !siteUrl.startsWith('https://')) {
    issues.push('SITE_URL must use HTTPS outside local development.');
  }

  const configuredCharityPercentage = readInteger(
    env.CHARITY_PERCENTAGE,
    V1_CHARITY_PERCENTAGE,
    'CHARITY_PERCENTAGE',
    issues,
  );
  const configuredPlatformPercentage = readInteger(
    env.PLATFORM_PERCENTAGE,
    V1_PLATFORM_PERCENTAGE,
    'PLATFORM_PERCENTAGE',
    issues,
  );
  const minimumCents = readInteger(
    env.MIN_CONTRIBUTION_CENTS,
    100,
    'MIN_CONTRIBUTION_CENTS',
    issues,
  );
  const { days: holdDays, valid: holdDaysValid } = parseCharityHoldDays(env);
  if (!holdDaysValid) {
    issues.push('CHARITY_HOLD_DAYS must be a whole number of days from 0 through 365.');
  }
  const maximumCents = readInteger(
    env.MAX_CONTRIBUTION_CENTS,
    STRIPE_MAXIMUM_USD_CENTS,
    'MAX_CONTRIBUTION_CENTS',
    issues,
  );

  if (configuredCharityPercentage + configuredPlatformPercentage !== 100) {
    issues.push('The charity and platform percentages must total 100.');
  }
  if (configuredCharityPercentage < 1 || configuredCharityPercentage > 100) {
    issues.push('CHARITY_PERCENTAGE must be between 1 and 100.');
  }
  if (configuredPlatformPercentage < 0 || configuredPlatformPercentage > 99) {
    issues.push('PLATFORM_PERCENTAGE must be between 0 and 99.');
  }
  if (
    configuredCharityPercentage !== V1_CHARITY_PERCENTAGE ||
    configuredPlatformPercentage !== V1_PLATFORM_PERCENTAGE
  ) {
    issues.push('Outcharity v1 is locked to the approved 90/10 allocation.');
  }
  if (minimumCents < 1 || maximumCents < minimumCents) {
    issues.push('The contribution limits are invalid.');
  }
  if (minimumCents < STRIPE_MINIMUM_USD_CENTS) {
    issues.push('MIN_CONTRIBUTION_CENTS is below Stripe’s USD minimum.');
  }
  if (maximumCents > STRIPE_MAXIMUM_USD_CENTS) {
    issues.push('MAX_CONTRIBUTION_CENTS exceeds Stripe’s USD maximum.');
  }

  const charityName = String(env.CHARITY_NAME || '').trim();
  const charityUrlIssues = [];
  const charityUrl = parseWebUrl(env.CHARITY_URL, 'CHARITY_URL', charityUrlIssues, {
    requireHttps: true,
  });
  const charityEin = String(env.CHARITY_EIN || '').trim();
  const charityDisclosure = String(env.CHARITY_DISCLOSURE || '').trim();
  const campaignHeadline = String(
    env.CAMPAIGN_HEADLINE || 'Buy Clout. Do good.',
  ).trim();

  const campaignIssues = [];
  if (!charityName || charityName.length > 120) {
    campaignIssues.push('CHARITY_NAME must contain 1 through 120 characters.');
  }
  campaignIssues.push(...charityUrlIssues);
  if (!/^\d{2}-?\d{7}$/.test(charityEin)) {
    campaignIssues.push('CHARITY_EIN must contain nine digits.');
  }
  if (!charityDisclosure || charityDisclosure.length > 600) {
    campaignIssues.push('CHARITY_DISCLOSURE must contain 1 through 600 characters.');
  }
  if (!campaignHeadline || campaignHeadline.length > 120) {
    campaignIssues.push('CAMPAIGN_HEADLINE must contain 1 through 120 characters.');
  }

  const launchApproved = String(env.OUTCHARITY_LAUNCH_APPROVED).toLowerCase() === 'true';
  const campaignConfigured = campaignIssues.length === 0;
  // Outside local development only live-mode Stripe credentials may take money, so a test-mode
  // key can never turn fake payments into real listings and real charity deliveries.
  const liveModeRequired = !isLocalUrl(requestOrigin);
  const stripeKeyIsLive = /^(?:sk|rk)_live_/.test(String(env.STRIPE_SECRET_KEY || ''));
  if (liveModeRequired && env.STRIPE_SECRET_KEY && !stripeKeyIsLive) {
    issues.push('STRIPE_SECRET_KEY must be a live-mode key outside local development.');
  }
  const paymentConfigured = Boolean(
    env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.GOODAPI_API_KEY,
  );
  const storageConfigured = Boolean(env.DB && env.LOGOS);
  const turnstile = getTurnstileConfig(env, requestOrigin);
  const protectionConfigured = Boolean(
    env.CHECKOUT_RATE_LIMITER?.limit &&
      env.LOOKUP_RATE_LIMITER?.limit &&
      turnstile.configured,
  );
  const deploymentConfigured = Boolean(
    siteUrl &&
      (isLocalUrl(requestOrigin)
        ? isLocalUrl(siteUrl)
        : siteUrl.startsWith('https://') && siteUrl === requestOrigin),
  );
  const checkoutEnabled =
    launchApproved &&
    campaignConfigured &&
    paymentConfigured &&
    storageConfigured &&
    protectionConfigured &&
    deploymentConfigured &&
    issues.length === 0;

  return {
    siteUrl,
    charityPercentage: V1_CHARITY_PERCENTAGE,
    platformPercentage: V1_PLATFORM_PERCENTAGE,
    minimumCents,
    maximumCents,
    charityHoldDays: holdDays,
    charityName,
    charityUrl,
    charityEin,
    charityDisclosure,
    campaignHeadline,
    turnstileSiteKey: turnstile.siteKey,
    turnstileHostnames: turnstile.hostnames,
    turnstileActions: turnstile.actions,
    turnstileConfigured: turnstile.configured,
    launchApproved,
    campaignConfigured,
    paymentConfigured,
    liveModeRequired,
    storageConfigured,
    protectionConfigured,
    deploymentConfigured,
    checkoutEnabled,
    publicCampaign: launchApproved && campaignConfigured && issues.length === 0,
    issues: [...issues, ...campaignIssues],
  };
}
