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

test('90/10 allocation uses integer cents and favors the charity on rounding', () => {
  assert.deepEqual(allocateCents(100_000, 90), {
    charityCents: 90_000,
    platformCents: 10_000,
  });
  assert.deepEqual(allocateCents(1_001, 90), {
    charityCents: 901,
    platformCents: 100,
  });
  assert.equal(formatMoney(1_001), '$10.01');
});

test('amount validation rejects malformed values and enforces configured bounds', () => {
  for (const value of ['-1', '1e3', '10.001', 'words']) {
    assert.throws(() => parseDollarAmount(value, 1_000, 100_000), InputError);
  }
  assert.throws(() => parseDollarAmount('9.99', 1_000, 100_000), InputError);
  assert.throws(() => parseDollarAmount('1,000.01', 1_000, 100_000), InputError);
  assert.equal(parseDollarAmount('10', 1_000, 100_000), 1_000);
  assert.equal(parseDollarAmount('$1,000', 1_000, 100_000), 100_000);
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
    {
      bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
      extension: 'png',
      contentType: 'image/png',
    },
    {
      bytes: Uint8Array.from([255, 216, 255, 224]),
      extension: 'jpg',
      contentType: 'image/jpeg',
    },
    {
      bytes: Uint8Array.from([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]),
      extension: 'webp',
      contentType: 'image/webp',
    },
  ]) {
    const file = {
      name: 'logo.txt',
      size: bytes.length,
      arrayBuffer: async () => bytes.buffer,
    };
    assert.deepEqual(await validateLogo(file), { bytes, extension, contentType });
  }

  const oversizedBytes = new Uint8Array(512 * 1024 + 1);
  oversizedBytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
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
