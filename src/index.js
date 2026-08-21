import { Hono } from 'hono';

import { deliverCharityPortion, retryUndeliveredCharityPortions } from './charity.js';
import { getConfig } from './config.js';
import {
  findAdvertiserByTokenHash,
  getContributionBySession,
  getLeaderboard,
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
  htmlResponse,
  invalidatePublicHomepage,
  publicCacheKey,
  requireReasonableBodySize,
  requireSameOrigin,
} from './http.js';
import {
  contributionFromCheckoutSession,
  expiredNewAdvertiserLogoKey,
  existingAdvertiserMetadata,
  newAdvertiserMetadata,
} from './payments.js';
import { createCheckoutSession, createStripeClient, verifyStripeEvent } from './providers.js';
import {
  aboutPage,
  homePage,
  managePage,
  messagePage,
  privacyPage,
  submitPage,
  successPage,
  termsPage,
} from './views.js';

const app = new Hono();

app.use('*', async (context, next) => {
  await next();
  const mutableResponse = new Response(context.res.body, {
    status: context.res.status,
    statusText: context.res.statusText,
    headers: new Headers(context.res.headers),
  });
  context.res = applySecurityHeaders(mutableResponse);
});

function configFor(context) {
  return getConfig(context.env, context.req.url);
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

function checkoutClosed(context, config) {
  const result = messagePage(config, {
    title: 'Checkout closed',
    heading: 'Checkout is not open yet.',
    message:
      'The charity agreement, approved campaign wording, payment credentials, and storage must all be ready before Outcharity accepts money.',
    status: 503,
  });
  return htmlResponse(context, result.document, result.status);
}

function contributionSessionInput(config, data) {
  return {
    amountCents: data.amountCents,
    advertiserId: data.advertiserId,
    charityName: config.charityName,
    charityPercentage: config.charityPercentage,
    metadata: data.metadata,
    successUrl: `${config.siteUrl}/success?session_id={CHECKOUT_SESSION_ID}&manage=${data.managementToken}`,
    cancelUrl: data.cancelUrl,
  };
}

app.get('/', async (context) => {
  const cache = globalThis.caches?.default;
  const cacheKey = publicCacheKey(context.req.raw);
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const config = configFor(context);
  const data = context.env.DB
    ? await getLeaderboard(context.env.DB)
    : { advertisers: [], grossCents: 0, charityCents: 0 };
  const response = await htmlResponse(
    context,
    homePage(config, data),
    200,
    'public, max-age=5, s-maxage=5, must-revalidate',
  );

  if (cache) context.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
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
  requireReasonableBodySize(context.req.raw);

  const formData = await context.req.formData();
  const values = safeFormValues(formData);
  let listing;
  let logo;
  try {
    listing = validateListingFields(formData, config);
    logo = await validateLogo(formData.get('logo'));
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    return htmlResponse(
      context,
      submitPage(config, { values, errors: error.fields, message: error.message }),
      422,
    );
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
        managementToken,
        cancelUrl: `${config.siteUrl}/submit?amount=${amountInputValue(listing.amountCents)}`,
      }),
    );
    return context.redirect(session.url, 303);
  } catch (error) {
    await context.env.LOGOS.delete(logoKey);
    console.error('Stripe Checkout Session creation failed.', { message: error.message });
    throw new Error('Secure checkout could not be started. Please try again.');
  }
});

app.get('/manage/:token', async (context) => {
  const config = configFor(context);
  const token = context.req.param('token');
  if (!isManagementToken(token)) {
    const result = messagePage(config, {
      title: 'Management link not found',
      heading: 'That management link is not valid.',
      message: 'Use the complete private link shown after the first confirmed payment.',
      status: 404,
    });
    return htmlResponse(context, result.document, result.status);
  }

  const advertiser = await findAdvertiserByTokenHash(context.env.DB, await hashToken(token));
  if (!advertiser) {
    const result = messagePage(config, {
      title: 'Management link not found',
      heading: 'That management link was not found.',
      message: 'Use the complete private link shown after the first confirmed payment.',
      status: 404,
    });
    return htmlResponse(context, result.document, result.status);
  }

  return htmlResponse(context, managePage(config, advertiser, token));
});

app.post('/manage/:token/checkout', async (context) => {
  const config = configFor(context);
  if (!config.checkoutEnabled) return checkoutClosed(context, config);
  requireSameOrigin(context.req.raw);
  requireReasonableBodySize(context.req.raw, 16 * 1024);

  const token = context.req.param('token');
  if (!isManagementToken(token)) throw Object.assign(new Error('Management link not found.'), { status: 404 });
  const advertiser = await findAdvertiserByTokenHash(context.env.DB, await hashToken(token));
  if (!advertiser) throw Object.assign(new Error('Management link not found.'), { status: 404 });
  if (advertiser.is_hidden) {
    throw Object.assign(new Error('This listing is hidden and cannot accept another payment.'), {
      status: 403,
    });
  }

  const formData = await context.req.formData();
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
      managementToken: token,
      cancelUrl: `${config.siteUrl}/manage/${token}`,
    }),
  );
  return context.redirect(session.url, 303);
});

app.post('/webhooks/stripe', async (context) => {
  const signature = context.req.header('stripe-signature');
  if (!signature || !context.env.STRIPE_WEBHOOK_SECRET || !context.env.STRIPE_SECRET_KEY) {
    return context.json({ error: 'Webhook configuration or signature is missing.' }, 400);
  }

  let event;
  try {
    const stripe = createStripeClient(context.env.STRIPE_SECRET_KEY);
    event = await verifyStripeEvent(
      stripe,
      await context.req.text(),
      signature,
      context.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    console.error('Stripe webhook signature verification failed.', { message: error.message });
    return context.json({ error: 'Invalid webhook signature.' }, 400);
  }

  try {
    if (event.type === 'checkout.session.expired') {
      const logoKey = expiredNewAdvertiserLogoKey(event.data.object);
      if (logoKey) await context.env.LOGOS.delete(logoKey);
      return context.json({ received: true, counted: false });
    }
    if (
      !['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(
        event.type,
      )
    ) {
      return context.json({ received: true, counted: false });
    }
    if (event.data.object.payment_status !== 'paid') {
      return context.json({ received: true, counted: false });
    }

    const record = contributionFromCheckoutSession(event.data.object);
    if (!record) return context.json({ received: true, counted: false });

    const result = await recordConfirmedContribution(context.env.DB, record);
    if (!result.contribution) throw new Error('Confirmed contribution was not found after recording.');
    if (result.inserted) await invalidatePublicHomepage(context.req.raw);

    if (result.contribution.charity_delivery_status !== 'delivered') {
      await deliverCharityPortion(context.env, result.contribution);
    }

    return context.json({ received: true, counted: result.inserted });
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
  const managementToken = context.req.query('manage') || '';
  const validSessionId = /^cs_(?:test|live)_[A-Za-z0-9_]{8,240}$/.test(sessionId);
  if (!validSessionId) {
    const result = messagePage(config, {
      title: 'Invalid payment link',
      heading: 'That payment link is invalid.',
      message: 'Open the success link returned after Stripe Checkout, or view the leaderboard.',
      status: 400,
    });
    return htmlResponse(context, result.document, result.status);
  }

  const contribution = await getContributionBySession(context.env.DB, sessionId);

  let managementTokenIsValid = false;
  if (contribution && isManagementToken(managementToken)) {
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

  const cache = globalThis.caches?.default;
  const cacheKey = new Request(context.req.url, { method: 'GET' });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const object = await context.env.LOGOS.get(key);
  if (!object) return context.notFound();
  const headers = new Headers({
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
    ETag: object.httpEtag,
  });
  const response = applySecurityHeaders(new Response(object.body, { headers }));
  if (cache) context.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});

app.get('/about', (context) => htmlResponse(context, aboutPage(configFor(context))));
app.get('/terms', (context) => htmlResponse(context, termsPage(configFor(context))));
app.get('/privacy', (context) => htmlResponse(context, privacyPage(configFor(context))));

app.get('/health', async (context) => {
  const config = configFor(context);
  const database = context.env.DB ? await context.env.DB.prepare('SELECT 1 AS ok').first() : null;
  const response = context.json({
    ok: database?.ok === 1,
    checkoutEnabled: config.checkoutEnabled,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

app.get('/sitemap.xml', (context) => {
  const config = configFor(context);
  const urls = ['/', '/about', '/terms', '/privacy'].map(
    (path) => `<url><loc>${config.siteUrl}${path === '/' ? '' : path}</loc></url>`,
  );
  return context.body(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`,
    200,
    { 'Content-Type': 'application/xml; charset=UTF-8', 'Cache-Control': 'public, max-age=3600' },
  );
});

app.notFound((context) => {
  const result = messagePage(configFor(context), {
    title: 'Not found',
    heading: 'That page does not exist.',
    message: 'The leaderboard is back at the front door.',
    status: 404,
  });
  return htmlResponse(context, result.document, result.status);
});

app.onError((error, context) => {
  const status = Number(error.status) || 500;
  if (status >= 500) console.error('Request failed.', { message: error.message });
  const result = messagePage(configFor(context), {
    title: status >= 500 ? 'Something went wrong' : 'Request stopped',
    heading: status >= 500 ? 'Something went wrong.' : 'That request was stopped.',
    message:
      status >= 500
        ? 'Please try again. If you just paid, check the leaderboard before starting another payment.'
        : error.message,
    status,
  });
  return htmlResponse(context, result.document, result.status);
});

export { app };

export default {
  fetch: app.fetch,
  scheduled(_event, env, context) {
    context.waitUntil(retryUndeliveredCharityPortions(env));
  },
};
