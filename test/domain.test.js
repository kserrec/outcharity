import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InputError,
  allocateCents,
  formatMoney,
  makeSlug,
  normalizeWebUrl,
  parseDollarAmount,
  sortLeaderboard,
  validateLogo,
} from '../src/domain.js';

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

test('amount validation rejects negative, malformed, and below-minimum values', () => {
  for (const value of ['-1', '1e3', '10.001', 'words']) {
    assert.throws(() => parseDollarAmount(value, 1_000, 100_000), InputError);
  }
  assert.throws(() => parseDollarAmount('9.99', 1_000, 100_000), InputError);
  assert.equal(parseDollarAmount('$1,000', 1_000, 100_000), 100_000);
});

test('URL validation accepts only credential-free HTTP and HTTPS links', () => {
  assert.equal(normalizeWebUrl('https://example.com'), 'https://example.com/');
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,hello',
    'not a url',
    'https://user:password@example.com',
  ]) {
    assert.throws(() => normalizeWebUrl(value), InputError);
  }
});

test('leaderboard ordering is total descending, then creation time, then ID', () => {
  const advertisers = [
    { id: 'b', total_contributed_cents: 1_000, created_at: '2026-01-01', is_hidden: 0 },
    { id: 'c', total_contributed_cents: 2_000, created_at: '2026-02-01', is_hidden: 0 },
    { id: 'a', total_contributed_cents: 1_000, created_at: '2026-01-01', is_hidden: 0 },
    { id: 'd', total_contributed_cents: 9_000, created_at: '2025-01-01', is_hidden: 1 },
  ];
  assert.deepEqual(
    sortLeaderboard(advertisers).map((advertiser) => advertiser.id),
    ['c', 'a', 'b'],
  );
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
  const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const png = {
    name: 'logo.txt',
    size: pngBytes.length,
    arrayBuffer: async () => pngBytes.buffer,
  };
  assert.deepEqual(await validateLogo(png), {
    bytes: pngBytes,
    extension: 'png',
    contentType: 'image/png',
  });

  const fakeImageBytes = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
  const fakeImage = {
    name: 'logo.png',
    size: fakeImageBytes.length,
    arrayBuffer: async () => fakeImageBytes.buffer,
  };
  await assert.rejects(() => validateLogo(fakeImage), InputError);
});
