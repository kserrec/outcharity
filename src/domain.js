const MAX_LOGO_BYTES = 512 * 1024;
const encoder = new TextEncoder();

export class InputError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = 'InputError';
    this.fields = fields;
  }
}

export function allocateCents(grossCents, charityPercentage) {
  if (!Number.isSafeInteger(grossCents) || grossCents <= 0) {
    throw new TypeError('Gross amount must be a positive integer number of cents.');
  }
  if (
    !Number.isSafeInteger(charityPercentage) ||
    charityPercentage < 1 ||
    charityPercentage > 100
  ) {
    throw new TypeError('Charity percentage must be a whole number from 1 through 100.');
  }

  // Any fractional cent goes to the charity so the public percentage is never underpaid.
  const charityCents = Math.ceil((grossCents * charityPercentage) / 100);
  return {
    charityCents,
    platformCents: grossCents - charityCents,
  };
}

export function parseDollarAmount(value, minimumCents, maximumCents) {
  const source = String(value ?? '').trim().replace(/^\$/, '').replaceAll(',', '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(source)) {
    throw new InputError('Enter a dollar amount with no more than two decimal places.', {
      amount: 'Enter a valid dollar amount.',
    });
  }

  const [whole, fraction = ''] = source.split('.');
  const centsBigInt = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (centsBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InputError('That amount is too large.', { amount: 'Enter a smaller amount.' });
  }

  const cents = Number(centsBigInt);
  if (cents < minimumCents) {
    throw new InputError(`The minimum contribution is ${formatMoney(minimumCents)}.`, {
      amount: `Enter at least ${formatMoney(minimumCents)}.`,
    });
  }
  if (cents > maximumCents) {
    throw new InputError(`The maximum contribution is ${formatMoney(maximumCents)}.`, {
      amount: `Enter no more than ${formatMoney(maximumCents)}.`,
    });
  }
  return cents;
}

export function formatMoney(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) return '$0';
  const dollars = Math.floor(cents / 100).toLocaleString('en-US');
  const remainder = cents % 100;
  return remainder === 0 ? `$${dollars}` : `$${dollars}.${String(remainder).padStart(2, '0')}`;
}

export function amountInputValue(cents) {
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`;
}

export function normalizeWebUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new InputError('Enter a complete HTTP or HTTPS URL.', {
      url: 'Use a URL such as https://example.com.',
    });
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new InputError('Enter a complete HTTP or HTTPS URL.', {
      url: 'Only HTTP and HTTPS links are allowed.',
    });
  }
  if (parsed.username || parsed.password) {
    throw new InputError('URLs containing usernames or passwords are not allowed.', {
      url: 'Remove the username and password from the URL.',
    });
  }
  parsed.hash = '';
  return parsed.toString();
}

export function displayHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function cleanLine(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function validateListingFields(formData, config) {
  const name = cleanLine(formData.get('name'));
  const description = cleanLine(formData.get('description'));
  const xSource = cleanLine(formData.get('x_handle')).replace(/^@/, '');
  const errors = {};

  if (name.length < 1 || name.length > 60) {
    errors.name = 'Use between 1 and 60 characters.';
  }
  if (description.length < 1 || description.length > 140) {
    errors.description = 'Use between 1 and 140 characters.';
  }
  if (xSource && !/^[A-Za-z0-9_]{1,15}$/.test(xSource)) {
    errors.x_handle = 'Use a valid X handle with up to 15 letters, numbers, or underscores.';
  }

  let url = '';
  try {
    url = normalizeWebUrl(formData.get('url'));
    if (url.length > 400) errors.url = 'Use a URL no longer than 400 characters.';
  } catch (error) {
    errors.url = error.fields?.url || error.message;
  }

  let amountCents = 0;
  try {
    amountCents = parseDollarAmount(
      formData.get('amount'),
      config.minimumCents,
      config.maximumCents,
    );
  } catch (error) {
    errors.amount = error.fields?.amount || error.message;
  }

  if (Object.keys(errors).length > 0) {
    throw new InputError('Please correct the highlighted fields.', errors);
  }

  return {
    name,
    description,
    url,
    xHandle: xSource || null,
    amountCents,
  };
}

export async function validateLogo(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || !file.name) {
    throw new InputError('Choose a logo image.', { logo: 'A logo is required.' });
  }
  if (file.size < 1 || file.size > MAX_LOGO_BYTES) {
    throw new InputError('The logo must be 512 KB or smaller.', {
      logo: 'Choose a PNG, JPEG, or WebP image no larger than 512 KB.',
    });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPng =
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  const isJpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const isWebp =
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';

  if (isPng) return { bytes, extension: 'png', contentType: 'image/png' };
  if (isJpeg) return { bytes, extension: 'jpg', contentType: 'image/jpeg' };
  if (isWebp) return { bytes, extension: 'webp', contentType: 'image/webp' };

  throw new InputError('That file is not a valid PNG, JPEG, or WebP image.', {
    logo: 'Choose a PNG, JPEG, or WebP image.',
  });
}

export function makeSlug(name, id) {
  const base = String(name)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 27);
  return `${base || 'listing'}-${id.replaceAll('-', '')}`;
}

export function makeManagementToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(token)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isManagementToken(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ''));
}
