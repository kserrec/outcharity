import Stripe from 'stripe';

const GOODAPI_BASE_URL = 'https://app.thegoodapi.com';
const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const STRIPE_REQUEST_TIMEOUT_MS = 20_000;
const TURNSTILE_REQUEST_TIMEOUT_MS = 10_000;
const TURNSTILE_TOKEN_MAX_LENGTH = 2_048;

export function createStripeClient(secretKey) {
  return new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
    timeout: STRIPE_REQUEST_TIMEOUT_MS,
    maxNetworkRetries: 1,
  });
}

// Stripe signs each event with the secret of one endpoint, and test-mode and live-mode endpoints
// have different secrets, so this check only catches a key and webhook secret taken from
// different modes. The production rule that actually keeps fake test payments out of the live
// site is in config.js: outside local development the secret key must be a live key, and the
// webhook handler refuses any event that is not live.
export function stripeModeMatches(secretKey, event) {
  const key = String(secretKey || '');
  const live = key.startsWith('sk_live_') || key.startsWith('rk_live_');
  const test = key.startsWith('sk_test_') || key.startsWith('rk_test_');
  if (!live && !test) return false;
  return event?.livemode === live;
}

export async function createCheckoutSession(stripe, input) {
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    // Require 3-D Secure authentication: under card-network rules an authenticated payment's
    // fraud-chargeback liability sits with the card issuer rather than with Outcharity.
    payment_method_options: { card: { request_three_d_secure: 'any' } },
    client_reference_id: input.advertiserId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: input.amountCents,
          product_data: {
            name: 'Outcharity leaderboard placement',
            description: `${input.charityPercentage}% supports ${input.charityName}. Ranking is based on confirmed lifetime contributions.`,
          },
        },
      },
    ],
    metadata: input.metadata,
    payment_intent_data: {
      metadata: {
        outcharity: 'true',
        advertiser_id: input.advertiserId,
      },
    },
    custom_text: {
      submit: {
        message: 'Rankings may change while you complete payment.',
      },
    },
  });

  if (!session.url) throw new Error('Stripe did not return a Checkout URL.');
  return session;
}

export async function verifyStripeEvent(stripe, rawBody, signature, webhookSecret) {
  return stripe.webhooks.constructEventAsync(
    rawBody,
    signature,
    webhookSecret,
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
}

export async function verifyTurnstileToken(
  { token, secret, remoteIp, expectedAction, expectedHostnames },
  fetcher = fetch,
) {
  const hostnames = new Set(
    Array.isArray(expectedHostnames)
      ? expectedHostnames.filter(
          (hostname) => typeof hostname === 'string' && /^\S{1,253}$/.test(hostname),
        )
      : [],
  );
  if (
    typeof token !== 'string' ||
    !/^\S+$/.test(token) ||
    token.length > TURNSTILE_TOKEN_MAX_LENGTH ||
    typeof secret !== 'string' ||
    !/^\S+$/.test(secret) ||
    typeof expectedAction !== 'string' ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(expectedAction) ||
    hostnames.size === 0
  ) {
    return false;
  }

  const body = new URLSearchParams({ secret, response: token });
  const clientAddress = typeof remoteIp === 'string' ? remoteIp.trim() : '';
  if (clientAddress) body.set('remoteip', clientAddress.slice(0, 64));

  try {
    const response = await fetcher(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TURNSTILE_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return (
      result?.success === true &&
      result.action === expectedAction &&
      hostnames.has(result.hostname)
    );
  } catch {
    return false;
  }
}

export async function createGoodApiDonation(contribution, apiKey, fetcher = fetch) {
  const response = await fetcher(`${GOODAPI_BASE_URL}/charities/donate`, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount_cents: contribution.charity_amount_cents,
      ein: contribution.charity_ein,
      charity_name: contribution.charity_name,
      idempotency_key: `outcharity-${contribution.stripe_checkout_session_id}`,
      attribution: 'outcharity',
      metadata: {
        contribution_id: contribution.id,
        checkout_session_id: contribution.stripe_checkout_session_id,
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const detail = parsed?.message || parsed?.error || body || 'no response body';
    throw new Error(`GoodAPI returned HTTP ${response.status}: ${String(detail).slice(0, 300)}`);
  }
  if (!parsed?.donation_id || parsed.amount_cents !== contribution.charity_amount_cents) {
    throw new Error('GoodAPI returned an incomplete or mismatched donation record.');
  }

  return parsed;
}

// A dispute or refund event normally names its payment intent directly. If it only names the
// charge, Stripe's charge record gives the payment intent.
export async function paymentIntentIdForCharge(stripe, chargeId) {
  const charge = await stripe.charges.retrieve(chargeId);
  const value =
    typeof charge?.payment_intent === 'string' ? charge.payment_intent : charge?.payment_intent?.id;
  return value || null;
}
