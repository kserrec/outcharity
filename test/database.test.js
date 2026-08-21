import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLeaderboard,
  listUndeliveredContributions,
  recordConfirmedContribution,
} from '../src/db.js';
import { makeSlug } from '../src/domain.js';
import { TestD1Database } from './helpers/d1.js';

function record({
  advertiserId,
  sessionId,
  paymentIntentId,
  amount = 1_000,
  advertiser = null,
}) {
  return {
    id: crypto.randomUUID(),
    advertiserId,
    advertiser,
    grossCents: amount,
    charityCents: Math.ceil((amount * 90) / 100),
    platformCents: amount - Math.ceil((amount * 90) / 100),
    charityPercentage: 90,
    platformPercentage: 10,
    charityName: 'Example Charity',
    charityEin: '12-3456789',
    stripeCheckoutSessionId: sessionId,
    stripePaymentIntentId: paymentIntentId,
  };
}

function advertiser(id, name) {
  return {
    id,
    slug: makeSlug(name, id),
    name,
    description: `${name} description`,
    url: `https://${name.toLowerCase()}.example/`,
    logoKey: `logos/${id}.png`,
    xHandle: null,
    managementTokenHash: id.replaceAll('-', '').padEnd(64, '0').slice(0, 64),
  };
}

test('leaderboard listings and totals come from one database snapshot', async () => {
  let prepareCalls = 0;
  const db = {
    prepare() {
      prepareCalls += 1;
      return {
        async all() {
          return {
            results: [
              {
                id: 'snapshot-advertiser',
                name: 'Snapshot',
                description: 'One consistent read.',
                url: 'https://snapshot.example/',
                logo_key: 'logos/11111111-1111-4111-8111-111111111111.png',
                total_contributed_cents: 1_000,
                created_at: '2026-01-01T00:00:00.000Z',
                gross_cents: 1_000,
                charity_cents: 900,
              },
            ],
          };
        },
      };
    },
  };

  const board = await getLeaderboard(db);
  assert.equal(prepareCalls, 1);
  assert.equal(board.advertisers.length, 1);
  assert.equal(board.advertisers[0].total_contributed_cents, board.grossCents);
  assert.equal(board.charityCents, 900);
  assert.equal('gross_cents' in board.advertisers[0], false);
});

test('distinct advertiser IDs with the same prefix cannot collide on slug', async (context) => {
  const db = new TestD1Database();
  context.after(() => db.close());
  const firstId = '12345678-1111-4111-8111-111111111111';
  const secondId = '12345678-2222-4222-8222-222222222222';

  for (const [id, session] of [
    [firstId, 'first'],
    [secondId, 'second'],
  ]) {
    await recordConfirmedContribution(
      db,
      record({
        advertiserId: id,
        sessionId: `cs_test_slug_${session}`,
        paymentIntentId: `pi_slug_${session}`,
        advertiser: advertiser(id, 'Acme'),
      }),
    );
  }

  const stored = await db.prepare('SELECT slug FROM advertisers ORDER BY id').all();
  assert.equal(stored.results.length, 2);
  assert.notEqual(stored.results[0].slug, stored.results[1].slug);
});

test('a successful payment counts once even when delivered twice', async (context) => {
  const db = new TestD1Database();
  context.after(() => db.close());
  const advertiserId = '11111111-1111-4111-8111-111111111111';
  const firstRecord = record({
    advertiserId,
    sessionId: 'cs_test_duplicate',
    paymentIntentId: 'pi_duplicate',
    amount: 1_001,
    advertiser: advertiser(advertiserId, 'Alpha'),
  });

  const first = await recordConfirmedContribution(db, firstRecord);
  const duplicate = await recordConfirmedContribution(db, {
    ...firstRecord,
    id: crypto.randomUUID(),
  });
  const count = await db.prepare('SELECT COUNT(*) AS count FROM contributions').first();
  const stored = await db.prepare('SELECT total_contributed_cents FROM advertisers').first();

  assert.equal(first.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.equal(count.count, 1);
  assert.equal(stored.total_contributed_cents, 1_001);
});

test('multiple confirmed payments accumulate on the existing advertiser', async (context) => {
  const db = new TestD1Database();
  context.after(() => db.close());
  const advertiserId = '22222222-2222-4222-8222-222222222222';
  await recordConfirmedContribution(
    db,
    record({
      advertiserId,
      sessionId: 'cs_test_first',
      paymentIntentId: 'pi_first',
      amount: 3_200,
      advertiser: advertiser(advertiserId, 'Bravo'),
    }),
  );
  await recordConfirmedContribution(
    db,
    record({
      advertiserId,
      sessionId: 'cs_test_second',
      paymentIntentId: 'pi_second',
      amount: 2_000,
    }),
  );

  const stored = await db.prepare('SELECT total_contributed_cents FROM advertisers').first();
  assert.equal(stored.total_contributed_cents, 5_200);
});

test('ranking uses total descending, earlier creation for ties, and hides flagged listings', async (context) => {
  const db = new TestD1Database();
  context.after(() => db.close());
  const alphaId = '33333333-3333-4333-8333-333333333333';
  const bravoId = '44444444-4444-4444-8444-444444444444';
  const charlieId = '55555555-5555-4555-8555-555555555555';

  for (const [id, name, amount, session] of [
    [alphaId, 'Alpha', 2_000, 'alpha'],
    [bravoId, 'Bravo', 2_000, 'bravo'],
    [charlieId, 'Charlie', 4_000, 'charlie'],
  ]) {
    await recordConfirmedContribution(
      db,
      record({
        advertiserId: id,
        sessionId: `cs_test_${session}`,
        paymentIntentId: `pi_${session}`,
        amount,
        advertiser: advertiser(id, name),
      }),
    );
  }
  await db
    .prepare('UPDATE advertisers SET created_at = ? WHERE id = ?')
    .bind('2026-01-01T00:00:00.000Z', alphaId)
    .run();
  await db
    .prepare('UPDATE advertisers SET created_at = ? WHERE id = ?')
    .bind('2026-01-02T00:00:00.000Z', bravoId)
    .run();

  let board = await getLeaderboard(db);
  assert.deepEqual(
    board.advertisers.map((entry) => entry.name),
    ['Charlie', 'Alpha', 'Bravo'],
  );

  await db.prepare('UPDATE advertisers SET is_hidden = 1 WHERE id = ?').bind(charlieId).run();
  board = await getLeaderboard(db);
  assert.deepEqual(
    board.advertisers.map((entry) => entry.name),
    ['Alpha', 'Bravo'],
  );
  assert.equal(board.grossCents, 8_000);
  assert.equal(board.charityCents, 7_200);
});

test('confirmed financial fields cannot be changed or deleted', async (context) => {
  const db = new TestD1Database();
  context.after(() => db.close());
  const advertiserId = '66666666-6666-4666-8666-666666666666';
  await recordConfirmedContribution(
    db,
    record({
      advertiserId,
      sessionId: 'cs_test_immutable',
      paymentIntentId: 'pi_immutable',
      advertiser: advertiser(advertiserId, 'Delta'),
    }),
  );

  await assert.rejects(() =>
    db.prepare('UPDATE contributions SET gross_amount_cents = 1').run(),
  );
  await assert.rejects(() => db.prepare('DELETE FROM contributions').run());
});

test('repeated failures cannot starve newer charity deliveries', async (context) => {
  const db = new TestD1Database();
  context.after(() => db.close());
  const advertiserId = '88888888-8888-4888-8888-888888888888';

  for (let index = 0; index < 27; index += 1) {
    await recordConfirmedContribution(
      db,
      record({
        advertiserId,
        sessionId: `cs_test_delivery_${String(index).padStart(2, '0')}`,
        paymentIntentId: `pi_delivery_${String(index).padStart(2, '0')}`,
        advertiser: index === 0 ? advertiser(advertiserId, 'Echo') : null,
      }),
    );
  }

  await db
    .prepare(
      `UPDATE contributions
       SET charity_delivery_status = 'failed',
           charity_delivery_attempts = 10
       WHERE stripe_checkout_session_id < 'cs_test_delivery_25'`,
    )
    .run();

  const selected = await listUndeliveredContributions(db);
  assert.equal(selected.length, 25);
  assert.deepEqual(
    selected
      .slice(0, 2)
      .map((contribution) => contribution.stripe_checkout_session_id)
      .sort(),
    ['cs_test_delivery_25', 'cs_test_delivery_26'],
  );
  assert.equal(selected.filter((contribution) => contribution.charity_delivery_attempts === 10).length, 23);
});
