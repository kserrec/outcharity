export function configuredEnvironment(overrides = {}) {
  return {
    OUTCHARITY_LAUNCH_APPROVED: 'true',
    SITE_URL: 'https://outcharity.com',
    CLOUDFLARE_ACCOUNT_ID: '82901762bf678507dc432f37e1bcb440',
    WEB_ANALYTICS_START_DATE: '2026-08-21',
    WEB_ANALYTICS_BASELINE_VISITS: '368',
    CHARITY_NAME: 'Example Charity',
    CHARITY_URL: 'https://charity.example',
    CHARITY_EIN: '12-3456789',
    CHARITY_DISCLOSURE: 'Approved disclosure.',
    CAMPAIGN_HEADLINE: 'Buy the top spot. Help people.',
    CHARITY_PERCENTAGE: '90',
    PLATFORM_PERCENTAGE: '10',
    MIN_CONTRIBUTION_CENTS: '100',
    MAX_CONTRIBUTION_CENTS: '10000000',
    CHARITY_HOLD_DAYS: '30',
    TURNSTILE_SITE_KEY: '0x4AAAAAAA-test-site-key',
    TURNSTILE_SECRET: 'turnstile-test-secret',
    TURNSTILE_HOSTNAMES: 'outcharity.com',
    STRIPE_SECRET_KEY: 'sk_live_placeholder',
    STRIPE_WEBHOOK_SECRET: 'configured',
    GOODAPI_API_KEY: 'configured',
    DB: {},
    LOGOS: {},
    CHECKOUT_RATE_LIMITER: { async limit() { return { success: true }; } },
    LOOKUP_RATE_LIMITER: { async limit() { return { success: true }; } },
    ...overrides,
  };
}

export const turnstileTestToken = 'turnstile-test-token';

export function successfulTurnstileResponse(action, hostname = 'outcharity.com') {
  return Response.json({ success: true, action, hostname });
}

export function turnstileAwareFetch(action, downstream) {
  return async (url, options) => {
    if (String(url) === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      return successfulTurnstileResponse(action);
    }
    return downstream(url, options);
  };
}

export const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
};
