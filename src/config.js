const DEFAULT_SITE_URL = 'http://localhost:8787';
const V1_CHARITY_PERCENTAGE = 90;
const V1_PLATFORM_PERCENTAGE = 10;

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
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
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
    1_000,
    'MIN_CONTRIBUTION_CENTS',
    issues,
  );
  const maximumCents = readInteger(
    env.MAX_CONTRIBUTION_CENTS,
    100_000_000,
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

  const charityName = String(env.CHARITY_NAME || '').trim();
  const charityUrlIssues = [];
  const charityUrl = parseWebUrl(env.CHARITY_URL, 'CHARITY_URL', charityUrlIssues, {
    requireHttps: true,
  });
  const charityEin = String(env.CHARITY_EIN || '').trim();
  const charityDisclosure = String(env.CHARITY_DISCLOSURE || '').trim();
  const campaignHeadline = String(
    env.CAMPAIGN_HEADLINE || 'Buy the top spot. Help the featured charity.',
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
  const paymentConfigured = Boolean(
    env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.GOODAPI_API_KEY,
  );
  const storageConfigured = Boolean(env.DB && env.LOGOS);
  const protectionConfigured = Boolean(
    env.CHECKOUT_RATE_LIMITER?.limit && env.LOOKUP_RATE_LIMITER?.limit,
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
    charityName,
    charityUrl,
    charityEin,
    charityDisclosure,
    campaignHeadline,
    launchApproved,
    campaignConfigured,
    paymentConfigured,
    storageConfigured,
    protectionConfigured,
    deploymentConfigured,
    checkoutEnabled,
    publicCampaign: launchApproved && campaignConfigured && issues.length === 0,
    issues: [...issues, ...campaignIssues],
  };
}
