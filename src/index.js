import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

import { syncCloudflareVisits } from './analytics.js';
import { deliverEligibleCharityPortions } from './charity.js';
import { getConfig } from './config.js';
import {
  findAdvertiserByTokenHash,
  getContributionBySession,
  getLeaderboard,
  getPublicStats,
  hideAdvertiserForPaymentIntent,
  isConfirmedLogo,
  isPublicLogo,
  recordConfirmedContribution,
} from './db.js';
import {
  InputError,
  amountInputValue,
  hashToken,
  isManagementToken,
  makeManagementToken,
  makeSlug,
  parseDollarAmount,
  validateListingFields,
  validateLogo,
} from './domain.js';
import {
  applySecurityHeaders,
  canonicalOriginResponse,
  htmlResponse,
  invalidatePublicLogo,
  invalidatePublicPages,
  isPrivatePath,
  publicAssetCacheKey,
  publicCacheKey,
  publicStatsCacheKey,
  readFormDataWithinLimit,
  readTextWithinLimit,
  revalidatingPublicResponse,
  requireRateLimit,
  requireSharedRateLimit,
  requireSameOrigin,
  shouldUseStrictTransport,
} from './http.js';
import {
  contributionFromCheckoutSession,
  expiredNewAdvertiserLogoKey,
  existingAdvertiserMetadata,
  newAdvertiserMetadata,
} from './payments.js';
import {
  createCheckoutSession,
  createStripeClient,
  paymentIntentIdForCharge,
  stripeModeMatches,
  verifyStripeEvent,
  verifyTurnstileToken,
} from './providers.js';
import {
  aboutPage,
  helpPage,
  homePage,
  managePage,
  messagePage,
  privacyPage,
  statsPage,
  submitPage,
  successPage,
  termsPage,
} from './views.js';

const app = new Hono();
const NEW_CHECKOUT_BODY_LIMIT = 700 * 1024;
const EXISTING_CHECKOUT_BODY_LIMIT = 16 * 1024;
const STRIPE_WEBHOOK_BODY_LIMIT = 1024 * 1024;
const MANAGEMENT_COOKIE_MAX_AGE_SECONDS = 2 * 24 * 60 * 60;
const ADVERTISER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTRIBUTION_EVENT_TYPES = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
];
// A refunded or disputed payment hides its listing until Kyle reviews it.
const LISTING_SUSPENSION_EVENT_TYPES = ['charge.dispute.created', 'charge.refunded'];

const PAYMENT_INTENT_ID_PATTERN = /^pi_[A-Za-z0-9_]{1,240}$/;
const CHARGE_ID_PATTERN = /^(?:ch|py)_[A-Za-z0-9_]{1,240}$/;

function idFromStripeField(value, pattern) {
  const id = typeof value === 'string' ? value : value?.id;
  return typeof id === 'string' && pattern.test(id) ? id : null;
}

// Disputes carry `payment_intent` and `charge`; a Charge object is its own charge ID.
async function paymentIntentIdFromStripeObject(stripe, object) {
  const direct = idFromStripeField(object?.payment_intent, PAYMENT_INTENT_ID_PATTERN);
  if (direct) return direct;
  const chargeId =
    object?.object === 'charge'
      ? idFromStripeField(object.id, CHARGE_ID_PATTERN)
      : idFromStripeField(object?.charge, CHARGE_ID_PATTERN);
  if (!chargeId) return null;
  return idFromStripeField(await paymentIntentIdForCharge(stripe, chargeId), PAYMENT_INTENT_ID_PATTERN);
}

app.use('*', async (context, next) => {
  const config = configFor(context);
  const canonicalResponse = await canonicalOriginResponse(context.req.raw, config.siteUrl);
  if (canonicalResponse) context.res = canonicalResponse;
  else await next();
  const mutableResponse = new Response(context.res.body, {
    status: context.res.status,
    statusText: context.res.statusText,
    headers: new Headers(context.res.headers),
  });
  context.res = applySecurityHeaders(mutableResponse, {
    strictTransport: shouldUseStrictTransport(context.req.raw, config.siteUrl),
    privateResponse: isPrivatePath(new URL(context.req.url).pathname),
  });
});

function configFor(context) {
  return getConfig(context.env, context.req.url);
}

function messageResponse(context, config, options) {
  const { document, status } = messagePage(config, options);
  return htmlResponse(context, document, status);
}

function requestError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function requireTurnstileProof(context, formData, config, expectedAction) {
  const verified = await verifyTurnstileToken({
    token: formData.get('cf-turnstile-response'),
    secret: context.env.TURNSTILE_SECRET,
    remoteIp: context.req.header('CF-Connecting-IP'),
    expectedAction,
    expectedHostnames: config.turnstileHostnames,
  });
  if (!verified) {
    throw requestError(403, 'Please complete the human-verification check and try again.');
  }
}

async function requireLookupLimits(request, limiter, clientScope) {
  await requireRateLimit(request, limiter, clientScope);
  await requireSharedRateLimit(request, limiter, 'lookup');
}

function safeFormValues(formData) {
  return {
    name: String(formData.get('name') || ''),
    url: String(formData.get('url') || ''),
    description: String(formData.get('description') || ''),
    x_handle: String(formData.get('x_handle') || ''),
    amount: String(formData.get('amount') || ''),
  };
}

// Every field is validated so one submission shows every problem at once, not one per round trip.
async function validateSubmission(formData, config) {
  const failures = [];
  const collect = (run) => run().catch((error) => {
    if (!(error instanceof InputError)) throw error;
    failures.push(error);
    return undefined;
  });
  const listing = await collect(async () => validateListingFields(formData, config));
  const logo = await collect(() => validateLogo(formData.get('logo')));
  if (failures.length === 0) return { listing, logo };
  return {
    errors: Object.assign({}, ...failures.map((failure) => failure.fields)),
    message: failures.length === 1 ? failures[0].message : 'Please correct the highlighted fields.',
  };
}

function checkoutClosed(context, config) {
  return messageResponse(context, config, {
    title: 'Checkout closed',
    heading: 'Checkout is not open yet.',
    message:
      'The charity agreement, approved campaign wording, payment credentials, and storage must all be ready before Outcharity accepts money.',
    status: 503,
  });
}

function contributionSessionInput(config, data) {
  return {
    amountCents: data.amountCents,
    advertiserId: data.advertiserId,
    charityName: config.charityName,
    charityPercentage: config.charityPercentage,
    metadata: data.metadata,
    successUrl: `${config.siteUrl}/success?session_id={CHECKOUT_SESSION_ID}&advertiser_id=${data.advertiserId}`,
    cancelUrl: data.cancelUrl,
  };
}

function managementLinkNotFound(context, config, heading, message) {
  return messageResponse(context, config, {
    title: 'Management link not found',
    heading,
    message,
    status: 404,
  });
}

function managementCookieName(advertiserId) {
  return `outcharity-manage-${advertiserId.replaceAll('-', '')}`;
}

function setManagementCookie(context, advertiserId, token) {
  setCookie(context, managementCookieName(advertiserId), token, {
    prefix: 'host',
    httpOnly: true,
    maxAge: MANAGEMENT_COOKIE_MAX_AGE_SECONDS,
    path: '/',
    priority: 'High',
    sameSite: 'Lax',
    secure: true,
  });
  context.header('Cache-Control', 'no-store');
}

function getManagementCookie(context, advertiserId) {
  if (!ADVERTISER_ID_PATTERN.test(advertiserId)) return '';
  return getCookie(context, managementCookieName(advertiserId), 'host') || '';
}

app.get('/', async (context) => {
  const cache = globalThis.caches?.default;
  const cacheKey = publicCacheKey(context.req.raw);
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return revalidatingPublicResponse(cached);
  }

  await requireSharedRateLimit(context.req.raw, context.env.LOOKUP_RATE_LIMITER, 'lookup');
  const config = configFor(context);
  const data = context.env.DB
    ? await getLeaderboard(context.env.DB)
    : {
        advertisers: [],
        recentPayments: [],
        grossCents: 0,
        charityCents: 0,
        paymentCount: 0,
        advertiserCount: 0,
        visitCount: null,
      };
  const response = await htmlResponse(
    context,
    homePage(config, data),
    200,
    'public, max-age=5, s-maxage=5, must-revalidate',
  );

  if (cache) context.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return revalidatingPublicResponse(response);
});

app.get('/submit', (context) => {
  const config = configFor(context);
  let amount = amountInputValue(config.minimumCents);
  const requestedAmount = context.req.query('amount');
  if (requestedAmount) {
    try {
      amount = amountInputValue(
        parseDollarAmount(requestedAmount, config.minimumCents, config.maximumCents),
      );
    } catch {
      // Invalid prefill values fall back to the configured minimum.
    }
  }
  return htmlResponse(context, submitPage(config, { values: { amount } }));
});

app.post('/checkout', async (context) => {
  const config = configFor(context);
  if (!config.checkoutEnabled) return checkoutClosed(context, config);
  requireSameOrigin(context.req.raw);
  await requireRateLimit(context.req.raw, context.env.CHECKOUT_RATE_LIMITER, 'new-checkout');
  const formData = await readFormDataWithinLimit(context.req.raw, NEW_CHECKOUT_BODY_LIMIT);
  await requireTurnstileProof(
    context,
    formData,
    config,
    config.turnstileActions.newCheckout,
  );
  await requireSharedRateLimit(context.req.raw, context.env.CHECKOUT_RATE_LIMITER, 'checkout');
  const values = safeFormValues(formData);
  const { listing, logo, errors, message } = await validateSubmission(formData, config);
  if (errors) {
    return htmlResponse(context, submitPage(config, { values, errors, message }), 422);
  }

  const advertiserId = crypto.randomUUID();
  const managementToken = makeManagementToken();
  const managementTokenHash = await hashToken(managementToken);
  const slug = makeSlug(listing.name, advertiserId);
  const logoKey = `logos/${advertiserId}.${logo.extension}`;
  const metadata = newAdvertiserMetadata(
    {
      ...listing,
      advertiserId,
      managementTokenHash,
      slug,
      logoKey,
    },
    config,
  );

  await context.env.LOGOS.put(logoKey, logo.bytes, {
    httpMetadata: { contentType: logo.contentType },
    customMetadata: { advertiserId },
  });

  try {
    const stripe = createStripeClient(context.env.STRIPE_SECRET_KEY);
    const session = await createCheckoutSession(
      stripe,
      contributionSessionInput(config, {
        amountCents: listing.amountCents,
        advertiserId,
        metadata,
        cancelUrl: `${config.siteUrl}/submit?amount=${amountInputValue(listing.amountCents)}`,
      }),
    );
    setManagementCookie(context, advertiserId, managementToken);
    return context.redirect(session.url, 303);
  } catch (error) {
    await context.env.LOGOS.delete(logoKey);
    console.error('Stripe Checkout Session creation failed.', { message: error.message });
    throw new Error('Secure checkout could not be started. Please try again.');
  }
});

app.get('/manage-return', (context) => {
  const config = configFor(context);
  const advertiserId = context.req.query('advertiser_id') || '';
  const token = getManagementCookie(context, advertiserId);
  if (!isManagementToken(token)) {
    return managementLinkNotFound(
      context,
      config,
      'That return link is no longer available.',
      'Use the private management link saved after the first confirmed payment.',
    );
  }
  return context.redirect(`/manage/${token}`, 303);
});

app.get('/manage/:token', async (context) => {
  const config = configFor(context);
  const token = context.req.param('token');
  if (!isManagementToken(token)) {
    return managementLinkNotFound(
      context,
      config,
      'That management link is not valid.',
      'Use the complete private link shown after the first confirmed payment.',
    );
  }

  await requireLookupLimits(context.req.raw, context.env.LOOKUP_RATE_LIMITER, 'manage');

  const advertiser = await findAdvertiserByTokenHash(context.env.DB, await hashToken(token));
  if (!advertiser) {
    return managementLinkNotFound(
      context,
      config,
      'That management link was not found.',
      'Use the complete private link shown after the first confirmed payment.',
    );
  }

  return htmlResponse(context, managePage(config, advertiser, token));
});

app.post('/manage/:token/checkout', async (context) => {
  const config = configFor(context);
  if (!config.checkoutEnabled) return checkoutClosed(context, config);
  requireSameOrigin(context.req.raw);

  const token = context.req.param('token');
  if (!isManagementToken(token)) throw requestError(404, 'Management link not found.');
  await requireRateLimit(
    context.req.raw,
    context.env.CHECKOUT_RATE_LIMITER,
    'existing-checkout',
  );
  const formData = await readFormDataWithinLimit(
    context.req.raw,
    EXISTING_CHECKOUT_BODY_LIMIT,
  );
  await requireTurnstileProof(
    context,
    formData,
    config,
    config.turnstileActions.existingCheckout,
  );
  await requireSharedRateLimit(context.req.raw, context.env.CHECKOUT_RATE_LIMITER, 'checkout');
  const advertiser = await findAdvertiserByTokenHash(context.env.DB, await hashToken(token));
  if (!advertiser) throw requestError(404, 'Management link not found.');
  if (advertiser.is_hidden) {
    throw requestError(403, 'This listing is hidden and cannot accept another payment.');
  }

  const amount = String(formData.get('amount') || '');
  let amountCents;
  try {
    amountCents = parseDollarAmount(amount, config.minimumCents, config.maximumCents);
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    return htmlResponse(
      context,
      managePage(config, advertiser, token, { amount, errors: error.fields }),
      422,
    );
  }

  const metadata = existingAdvertiserMetadata(
    { advertiserId: advertiser.id, amountCents },
    config,
  );
  const stripe = createStripeClient(context.env.STRIPE_SECRET_KEY);
  const session = await createCheckoutSession(
    stripe,
    contributionSessionInput(config, {
      amountCents,
      advertiserId: advertiser.id,
      metadata,
      cancelUrl: `${config.siteUrl}/manage-return?advertiser_id=${advertiser.id}`,
    }),
  );
  setManagementCookie(context, advertiser.id, token);
  return context.redirect(session.url, 303);
});

const NOT_COUNTED = { received: true, counted: false };

// An expired session may only remove a logo that no confirmed listing owns, so the deletion
// never depends on the session's metadata alone.
async function handleExpiredSession(context, session) {
  const logoKey = expiredNewAdvertiserLogoKey(session);
  if (logoKey && !(await isConfirmedLogo(context.env.DB, logoKey))) {
    await context.env.LOGOS.delete(logoKey);
  }
  return NOT_COUNTED;
}

async function handleListingSuspension(context, stripe, event) {
  const hidden = await hideAdvertiserForPaymentIntent(
    context.env.DB,
    await paymentIntentIdFromStripeObject(stripe, event.data.object),
    event.type,
  );
  if (hidden) {
    await Promise.all([
      invalidatePublicPages(context.req.raw),
      invalidatePublicLogo(context.req.raw, hidden.logoKey),
    ]);
  }
  return { ...NOT_COUNTED, hidden: Boolean(hidden) };
}

// Records the payment only. The scheduled task delivers the charity share after the hold window
// (CHARITY_HOLD_DAYS) unless the payment is refunded or disputed first.
async function handleConfirmedContribution(context, session) {
  if (session.payment_status !== 'paid') return NOT_COUNTED;
  const record = contributionFromCheckoutSession(session);
  if (!record) return NOT_COUNTED;

  const result = await recordConfirmedContribution(context.env.DB, record);
  if (!result.contribution) throw new Error('Confirmed contribution was not found after recording.');
  if (result.inserted) await invalidatePublicPages(context.req.raw);
  return { received: true, counted: result.inserted };
}

function fulfillStripeEvent(context, stripe, event) {
  if (event.type === 'checkout.session.expired') {
    return handleExpiredSession(context, event.data.object);
  }
  if (LISTING_SUSPENSION_EVENT_TYPES.includes(event.type)) {
    return handleListingSuspension(context, stripe, event);
  }
  if (CONTRIBUTION_EVENT_TYPES.includes(event.type)) {
    return handleConfirmedContribution(context, event.data.object);
  }
  return NOT_COUNTED;
}

app.post('/webhooks/stripe', async (context) => {
  const signature = context.req.header('stripe-signature');
  if (!signature || !context.env.STRIPE_WEBHOOK_SECRET || !context.env.STRIPE_SECRET_KEY) {
    return context.json({ error: 'Webhook configuration or signature is missing.' }, 400);
  }

  const payload = await readTextWithinLimit(context.req.raw, STRIPE_WEBHOOK_BODY_LIMIT);
  let event;
  const stripe = createStripeClient(context.env.STRIPE_SECRET_KEY);
  try {
    event = await verifyStripeEvent(
      stripe,
      payload,
      signature,
      context.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    // Invalid signatures are ordinary hostile input, not an operational failure worth amplifying
    // into paid logs. Signed mode mismatches and fulfillment failures remain logged below.
    return context.json({ error: 'Invalid webhook signature.' }, 400);
  }
  const config = configFor(context);
  if (
    !stripeModeMatches(context.env.STRIPE_SECRET_KEY, event) ||
    (config.liveModeRequired && event.livemode !== true)
  ) {
    console.error('Stripe webhook event mode does not match the configured secret key.', {
      eventId: event.id,
      livemode: event.livemode,
    });
    return context.json({ error: 'Webhook event mode does not match this deployment.' }, 400);
  }

  try {
    return context.json(await fulfillStripeEvent(context, stripe, event));
  } catch (error) {
    console.error('Stripe webhook fulfillment failed.', {
      eventId: event.id,
      message: error.message,
    });
    return context.json({ error: 'Webhook fulfillment failed.' }, 500);
  }
});

app.get('/success', async (context) => {
  const config = configFor(context);
  const sessionId = context.req.query('session_id') || '';
  const advertiserId = context.req.query('advertiser_id') || '';
  const managementToken = getManagementCookie(context, advertiserId);
  const validSessionId = /^cs_(?:test|live)_[A-Za-z0-9_]{8,240}$/.test(sessionId);
  if (!validSessionId) {
    return messageResponse(context, config, {
      title: 'Invalid payment link',
      heading: 'That payment link is invalid.',
      message: 'Open the success link returned after Stripe Checkout, or view the leaderboard.',
      status: 400,
    });
  }
  await requireLookupLimits(context.req.raw, context.env.LOOKUP_RATE_LIMITER, 'success');

  const contribution = await getContributionBySession(context.env.DB, sessionId);

  let managementTokenIsValid = false;
  if (
    contribution &&
    contribution.advertiser_id === advertiserId &&
    isManagementToken(managementToken)
  ) {
    managementTokenIsValid =
      (await hashToken(managementToken)) === contribution.management_token_hash;
  }
  return htmlResponse(
    context,
    successPage(config, contribution, managementTokenIsValid, managementToken),
  );
});

app.get('/logos/*', async (context) => {
  const key = context.req.path.slice(1);
  if (!/^logos\/[0-9a-f-]{36}\.(?:png|jpg|webp)$/i.test(key)) return context.notFound();
  if (new URL(context.req.url).pathname !== `/${key}`) return context.notFound();

  const cache = globalThis.caches?.default;
  const cacheKey = publicAssetCacheKey(context.req.raw);
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  await requireLookupLimits(context.req.raw, context.env.LOOKUP_RATE_LIMITER, 'logo');

  if (!(await isPublicLogo(context.env.DB, key))) return context.notFound();

  const object = await context.env.LOGOS.get(key);
  if (!object) return context.notFound();
  const headers = new Headers({
    'Cache-Control': 'public, max-age=60, s-maxage=60, must-revalidate',
    'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
    ETag: object.httpEtag,
  });
  const response = applySecurityHeaders(new Response(object.body, { headers }));
  if (cache) context.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});

app.get('/about', (context) => htmlResponse(context, aboutPage(configFor(context))));
app.get('/help', (context) => htmlResponse(context, helpPage(configFor(context))));
app.get('/stats', async (context) => {
  const cache = globalThis.caches?.default;
  const cacheKey = publicStatsCacheKey(context.req.raw);
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return revalidatingPublicResponse(cached);
  }

  await requireSharedRateLimit(context.req.raw, context.env.LOOKUP_RATE_LIMITER, 'lookup');
  const stats = context.env.DB
    ? await getPublicStats(context.env.DB)
    : {
        totalPaidCents: 0,
        charityCents: 0,
        recordedCharityCents: 0,
        deliveredCharityCents: 0,
        awaitingCharityCents: 0,
        stoppedCharityCents: 0,
        paymentCount: 0,
        advertiserCount: 0,
        averagePaymentCents: 0,
        visitCount: null,
      };
  const response = await htmlResponse(
    context,
    statsPage(configFor(context), stats),
    200,
    'public, max-age=5, s-maxage=5, must-revalidate',
  );
  if (cache) context.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return revalidatingPublicResponse(response);
});
app.get('/terms', (context) => htmlResponse(context, termsPage(configFor(context))));
app.get('/privacy', (context) => htmlResponse(context, privacyPage(configFor(context))));

app.get('/health', (context) => {
  const config = configFor(context);
  const response = context.json({
    ok: true,
    checkoutEnabled: config.checkoutEnabled,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

app.get('/sitemap.xml', (context) => {
  const config = configFor(context);
  const urls = ['/', '/stats', '/help', '/about', '/terms', '/privacy'].map(
    (path) => `<url><loc>${config.siteUrl}${path === '/' ? '' : path}</loc></url>`,
  );
  return context.body(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`,
    200,
    { 'Content-Type': 'application/xml; charset=UTF-8', 'Cache-Control': 'public, max-age=3600' },
  );
});

app.notFound((context) => {
  return messageResponse(context, configFor(context), {
    title: 'Not found',
    heading: 'That page does not exist.',
    message: 'The leaderboard is back at the front door.',
    status: 404,
  });
});

app.onError((error, context) => {
  const status = Number(error.status) || 500;
  if (status >= 500) console.error('Request failed.', { message: error.message });
  return messageResponse(context, configFor(context), {
    title: status >= 500 ? 'Something went wrong' : 'Request stopped',
    heading: status >= 500 ? 'Something went wrong.' : 'That request was stopped.',
    message:
      status >= 500
        ? 'Please try again. If you just paid, check the leaderboard before starting another payment.'
        : error.message,
    status,
  });
});

export { app };

export default {
  fetch: app.fetch,
  scheduled(_event, env, context) {
    context.waitUntil(
      Promise.all([
        deliverEligibleCharityPortions(env),
        syncCloudflareVisits(env).catch((error) => {
          console.error('Cloudflare analytics sync failed.', { message: error.message });
          return { synced: false, reason: 'failed' };
        }),
      ]),
    );
  },
};
