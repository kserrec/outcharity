import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InputError,
  allocateCents,
  formatMoney,
  makeSlug,
  normalizeWebUrl,
  parseDollarAmount,
  validateListingFields,
  validateLogo,
} from '../src/domain.js';
import { jpegBytes, pngBytes, webpBytes } from './helpers/images.js';

function listingForm(overrides = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    name: 'Acme',
    description: 'A short description.',
    url: 'https://example.com',
    amount: '25',
    ...overrides,
  })) {
    form.set(key, value);
  }
  return form;
}

test('95/5 allocation uses integer cents and favors the charity on rounding', () => {
  assert.deepEqual(allocateCents(100_000, 95), {
    charityCents: 95_000,
    platformCents: 5_000,
  });
  assert.deepEqual(allocateCents(1_001, 95), {
    charityCents: 951,
    platformCents: 50,
  });
  assert.equal(formatMoney(1_001), '$10.01');
});

test('amount validation rejects malformed values and enforces configured bounds', () => {
  for (const value of [
    '-1',
    '1e3',
    '10.001',
    'words',
    '10,50',
    '1,00',
    '1,,000',
    '12,34,567',
  ]) {
    assert.throws(() => parseDollarAmount(value, 1_000, 100_000), InputError);
  }
  assert.throws(() => parseDollarAmount('9.99', 1_000, 100_000), InputError);
  assert.throws(() => parseDollarAmount('1,000.01', 1_000, 100_000), InputError);
  assert.equal(parseDollarAmount('10', 1_000, 100_000), 1_000);
  assert.equal(parseDollarAmount('$1,000', 1_000, 100_000), 100_000);
  assert.equal(parseDollarAmount('1,000.01', 1_000, 200_000), 100_001);
});

test('URL validation accepts only credential-free HTTP and HTTPS links', () => {
  assert.equal(normalizeWebUrl('https://example.com'), 'https://example.com/');
  assert.equal(normalizeWebUrl('http://example.com/path#section'), 'http://example.com/path');
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,hello',
    'not a url',
    'https://user:password@example.com',
  ]) {
    assert.throws(() => normalizeWebUrl(value), InputError);
  }
});

test('listing text validation protects the pre-payment storage boundaries', () => {
  const config = { minimumCents: 1_000, maximumCents: 100_000 };
  assert.deepEqual(validateListingFields(listingForm(), config), {
    name: 'Acme',
    description: 'A short description.',
    url: 'https://example.com/',
    xHandle: null,
    amountCents: 2_500,
  });

  for (const [field, value, label] of [
    ['name', '', 'empty name'],
    ['name', 'A'.repeat(61), 'overlong name'],
    ['description', '', 'empty description'],
    ['description', 'D'.repeat(141), 'overlong description'],
  ]) {
    assert.throws(
      () => validateListingFields(listingForm({ [field]: value }), config),
      (error) => error instanceof InputError && Boolean(error.fields[field]),
      label,
    );
  }
});

test('advertiser slugs preserve the full unique ID within the metadata limit', () => {
  const firstId = '12345678-1111-4111-8111-111111111111';
  const secondId = '12345678-2222-4222-8222-222222222222';
  const firstSlug = makeSlug('A'.repeat(60), firstId);
  const secondSlug = makeSlug('A'.repeat(60), secondId);

  assert.notEqual(firstSlug, secondSlug);
  assert.equal(firstSlug.length, 60);
  assert.match(firstSlug, new RegExp(firstId.replaceAll('-', '') + '$'));
});

test('logo validation checks file bytes instead of trusting the filename or MIME label', async () => {
  for (const { bytes, extension, contentType } of [
    { bytes: pngBytes(80, 80), extension: 'png', contentType: 'image/png' },
    { bytes: jpegBytes(80, 80), extension: 'jpg', contentType: 'image/jpeg' },
    { bytes: webpBytes(80, 80), extension: 'webp', contentType: 'image/webp' },
    { bytes: webpBytes(80, 80, 'VP8L'), extension: 'webp', contentType: 'image/webp' },
    { bytes: webpBytes(80, 80, 'VP8X'), extension: 'webp', contentType: 'image/webp' },
  ]) {
    const file = {
      name: 'logo.txt',
      size: bytes.length,
      arrayBuffer: async () => bytes.buffer,
    };
    assert.deepEqual(await validateLogo(file), { bytes, extension, contentType });
  }

  const oversizedBytes = new Uint8Array(512 * 1024 + 1);
  oversizedBytes.set(pngBytes());
  await assert.rejects(
    () =>
      validateLogo({
        name: 'oversized.png',
        size: oversizedBytes.length,
        arrayBuffer: async () => oversizedBytes.buffer,
      }),
    InputError,
  );

  const fakeImageBytes = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
  const fakeImage = {
    name: 'logo.png',
    size: fakeImageBytes.length,
    arrayBuffer: async () => fakeImageBytes.buffer,
  };
  await assert.rejects(() => validateLogo(fakeImage), InputError);
});

test('logo validation rejects images whose headers declare oversized or missing dimensions', async () => {
  const cases = [
    ['png', pngBytes(2049, 1)],
    ['png', pngBytes(1, 30000)],
    ['png', pngBytes(0, 1)],
    ['jpg', jpegBytes(1, 2049)],
    ['jpg', jpegBytes(65535, 65535)],
    ['webp', webpBytes(2049, 1)],
    ['webp', webpBytes(1, 5000, 'VP8L')],
    ['webp', webpBytes(16384, 16384, 'VP8X')],
  ];
  for (const [label, bytes] of cases) {
    await assert.rejects(
      () => validateLogo({ name: `logo.${label}`, size: bytes.length, arrayBuffer: async () => bytes.buffer }),
      (error) => error instanceof InputError && /2048 pixels/.test(error.message),
      `${label} ${bytes.length} bytes`,
    );
  }
  const accepted = await validateLogo({
    name: 'edge.png',
    size: pngBytes(2048, 2048).length,
    arrayBuffer: async () => pngBytes(2048, 2048).buffer,
  });
  assert.equal(accepted.extension, 'png');

  // Files with a valid signature but no readable header are "not a valid image", not "too large".
  for (const [label, bytes] of [
    ['png', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0])],
    ['jpg', Uint8Array.from([255, 216, 255, 224])],
    ['jpg', Uint8Array.from([255, 216, 255, 224, 255, 255])],
    ['webp', Uint8Array.from([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80])],
  ]) {
    await assert.rejects(
      () => validateLogo({ name: `logo.${label}`, size: bytes.length, arrayBuffer: async () => bytes.buffer }),
      (error) => error instanceof InputError && /not a valid/.test(error.message),
      label,
    );
  }
});

test('listing text drops control and invisible formatting characters', () => {
  const form = new FormData();
  form.set('name', 'Acme\u202E moc.live\u200B');
  form.set('description', 'Plain\u0007 text\uFEFF here\u2066!');
  form.set('url', 'https://example.com');
  form.set('amount', '10');
  const listing = validateListingFields(form, { minimumCents: 1_000, maximumCents: 99_999_999 });
  assert.equal(listing.name, 'Acme moc.live');
  assert.equal(listing.description, 'Plain text here!');

  // Joiners and variation selectors that real names need are preserved.
  const scripts = new FormData();
  scripts.set('name', '👨\u200D👩\u200D👧 Family 🏳\uFE0F\u200D🌈');
  scripts.set('description', 'می\u200Cخواهم');
  scripts.set('url', 'https://example.com');
  scripts.set('amount', '10');
  const kept = validateListingFields(scripts, { minimumCents: 1_000, maximumCents: 99_999_999 });
  assert.equal(kept.name, '👨\u200D👩\u200D👧 Family 🏳\uFE0F\u200D🌈');
  assert.equal(kept.description, 'می\u200Cخواهم');

  const invisibleOnly = new FormData();
  invisibleOnly.set('name', '\u200B\u202E\u3164\u3164\u2800\u115F\u1160\uFFA0\u034F\u180E\u061C');
  invisibleOnly.set('description', 'ok');
  invisibleOnly.set('url', 'https://example.com');
  invisibleOnly.set('amount', '10');
  assert.throws(
    () => validateListingFields(invisibleOnly, { minimumCents: 1_000, maximumCents: 99_999_999 }),
    (error) => error instanceof InputError && Boolean(error.fields.name),
  );
});
