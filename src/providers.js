import Stripe from 'stripe';

const GOODAPI_BASE_URL = 'https://app.thegoodapi.com';

export function createStripeClient(secretKey) {
  return new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export async function createCheckoutSession(stripe, input) {
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
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
