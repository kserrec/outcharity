import { allocateCents, normalizeWebUrl } from './domain.js';

const ADVERTISER_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const LOGO_KEY_PATTERN = /^logos\/([0-9a-f-]{36})\.(?:png|jpg|webp)$/i;

function integerMetadata(value, name) {
  if (!/^\d+$/.test(String(value || ''))) {
    throw new Error(`Stripe metadata field ${name} is invalid.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Stripe metadata field ${name} is outside the supported range.`);
  }
  return parsed;
}

function contributionMetadata(kind, input, config) {
  return {
    outcharity: 'v1',
    kind,
    advertiser_id: input.advertiserId,
    requested_amount_cents: String(input.amountCents),
    charity_percentage: String(config.charityPercentage),
    platform_percentage: String(config.platformPercentage),
    charity_name: config.charityName,
    charity_ein: config.charityEin,
  };
}

export function newAdvertiserMetadata(input, config) {
  return {
    ...contributionMetadata('new', input, config),
    slug: input.slug,
    name: input.name,
    description: input.description,
    url: input.url,
    logo_key: input.logoKey,
    x_handle: input.xHandle || '',
    management_token_hash: input.managementTokenHash,
  };
}

export function existingAdvertiserMetadata(input, config) {
  return contributionMetadata('existing', input, config);
}

export function expiredNewAdvertiserLogoKey(session) {
  const metadata = session?.metadata || {};
  if (metadata.outcharity !== 'v1' || metadata.kind !== 'new') return null;

  const advertiserId = String(metadata.advertiser_id || '');
  const logoKey = String(metadata.logo_key || '');
  const match = LOGO_KEY_PATTERN.exec(logoKey);
  return match && match[1].toLowerCase() === advertiserId.toLowerCase() ? logoKey : null;
}

function parseNewAdvertiser(metadata) {
  const id = String(metadata.advertiser_id || '');
  const slug = String(metadata.slug || '');
  const name = String(metadata.name || '').trim();
  const description = String(metadata.description || '').trim();
  const logoKey = String(metadata.logo_key || '');
  const xHandle = String(metadata.x_handle || '').trim() || null;
  const managementTokenHash = String(metadata.management_token_hash || '');
  const url = normalizeWebUrl(metadata.url);

  if (!ADVERTISER_ID_PATTERN.test(id)) throw new Error('Stripe advertiser ID is invalid.');
  if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(slug)) throw new Error('Stripe slug is invalid.');
  if (name.length < 1 || name.length > 60) throw new Error('Stripe advertiser name is invalid.');
  if (description.length < 1 || description.length > 140) {
    throw new Error('Stripe advertiser description is invalid.');
  }
  if (!LOGO_KEY_PATTERN.test(logoKey)) {
    throw new Error('Stripe logo key is invalid.');
  }
  if (xHandle && !/^[A-Za-z0-9_]{1,15}$/.test(xHandle)) {
    throw new Error('Stripe X handle is invalid.');
  }
  if (!/^[a-f0-9]{64}$/.test(managementTokenHash)) {
    throw new Error('Stripe management token hash is invalid.');
  }

  return {
    id,
    slug,
    name,
    description,
    url,
    logoKey,
    xHandle,
    managementTokenHash,
  };
}

export function contributionFromCheckoutSession(session) {
  const metadata = session.metadata || {};
  if (metadata.outcharity !== 'v1') return null;
  if (!['new', 'existing'].includes(metadata.kind)) {
    throw new Error('Stripe contribution kind is invalid.');
  }
  if (session.mode !== 'payment' || session.payment_status !== 'paid') {
    throw new Error('Stripe Checkout Session is not a confirmed payment.');
  }
  if (String(session.currency).toLowerCase() !== 'usd') {
    throw new Error('Stripe Checkout Session currency is not USD.');
  }

  const grossCents = Number(session.amount_total);
  if (!Number.isSafeInteger(grossCents) || grossCents <= 0) {
    throw new Error('Stripe Checkout Session total is invalid.');
  }
  const requestedCents = integerMetadata(metadata.requested_amount_cents, 'requested_amount_cents');
  if (grossCents !== requestedCents) {
    throw new Error('Stripe Checkout Session total does not match its server-created amount.');
  }

  const charityPercentage = integerMetadata(metadata.charity_percentage, 'charity_percentage');
  const platformPercentage = integerMetadata(metadata.platform_percentage, 'platform_percentage');
  if (
    charityPercentage < 1 ||
    charityPercentage > 100 ||
    platformPercentage < 0 ||
    platformPercentage > 99 ||
    charityPercentage + platformPercentage !== 100
  ) {
    throw new Error('Stripe allocation metadata is invalid.');
  }

  const charityName = String(metadata.charity_name || '').trim();
  const charityEin = String(metadata.charity_ein || '').trim();
  if (!charityName || charityName.length > 120 || !/^\d{2}-?\d{7}$/.test(charityEin)) {
    throw new Error('Stripe charity metadata is invalid.');
  }

  const advertiserId = String(metadata.advertiser_id || '');
  if (!ADVERTISER_ID_PATTERN.test(advertiserId)) {
    throw new Error('Stripe advertiser ID is invalid.');
  }

  const paymentIntent =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!paymentIntent) throw new Error('Stripe payment intent ID is missing.');

  const allocation = allocateCents(grossCents, charityPercentage);
  return {
    id: crypto.randomUUID(),
    advertiserId,
    advertiser: metadata.kind === 'new' ? parseNewAdvertiser(metadata) : null,
    grossCents,
    charityCents: allocation.charityCents,
    platformCents: allocation.platformCents,
    charityPercentage,
    platformPercentage,
    charityName,
    charityEin,
    stripeCheckoutSessionId: String(session.id),
    stripePaymentIntentId: String(paymentIntent),
  };
}
