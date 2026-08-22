import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findAdvertiserByTokenHash,
  getContributionBySession,
  getLeaderboard,
  isPublicLogo,
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

test('ranking uses total descending, earlier total reach for ties, and hides flagged listings', async (context) => {
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

  await db
    .prepare('UPDATE advertisers SET created_at = ? WHERE id = ?')
    .bind('2026-01-01T00:00:00.000Z', bravoId)
    .run();
  board = await getLeaderboard(db);
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
  assert.equal(await isPublicLogo(db, `logos/${charlieId}.png`), false);
  assert.equal(await isPublicLogo(db, `logos/${alphaId}.png`), true);
});

test('a tie favors the advertiser that reached its current total first', async (context) => {
  const db = new TestD1Database();
  context.after(() => db.close());
  const olderId = '10101010-1010-4010-8010-101010101010';
  const newerId = '20202020-2020-4020-8020-202020202020';
  const olderAdvertiser = advertiser(olderId, 'Older');
  const newerAdvertiser = advertiser(newerId, 'Newer');

  await recordConfirmedContribution(
    db,
    record({
      advertiserId: olderId,
      sessionId: 'cs_test_older_first',
      paymentIntentId: 'pi_older_first',
      amount: 1_000,
      advertiser: olderAdvertiser,
    }),
  );
  await recordConfirmedContribution(
    db,
    record({
      advertiserId: newerId,
      sessionId: 'cs_test_newer_first',
      paymentIntentId: 'pi_newer_first',
      amount: 2_000,
      advertiser: newerAdvertiser,
    }),
  );
  await recordConfirmedContribution(
    db,
    record({
      advertiserId: olderId,
      sessionId: 'cs_test_older_second',
      paymentIntentId: 'pi_older_second',
      amount: 1_000,
    }),
  );

  await db
    .prepare('UPDATE advertisers SET created_at = ? WHERE id = ?')
    .bind('2026-01-01T00:00:00.000Z', olderId)
    .run();
  await db
    .prepare('UPDATE advertisers SET created_at = ? WHERE id = ?')
    .bind('2026-01-02T00:00:00.000Z', newerId)
    .run();

  const board = await getLeaderboard(db);
  assert.deepEqual(
    board.advertisers.map((entry) => entry.name),
    ['Newer', 'Older'],
  );

  const managedOlder = await findAdvertiserByTokenHash(
    db,
    olderAdvertiser.managementTokenHash,
  );
  const newerSuccess = await getContributionBySession(db, 'cs_test_newer_first');
  const olderSuccess = await getContributionBySession(db, 'cs_test_older_second');
  assert.equal(managedOlder.rank, 2);
  assert.equal(newerSuccess.rank, 1);
  assert.equal(olderSuccess.rank, 2);
});

test('confirmed contribution identity, allocation, provenance, and time are immutable', async (context) => {
  const db = new TestD1Database();
  context.after(() => db.close());
  const advertiserId = '66666666-6666-4666-8666-666666666666';
  const otherAdvertiserId = '99999999-9999-4999-8999-999999999999';
  const confirmed = record({
    advertiserId,
    sessionId: 'cs_test_immutable',
    paymentIntentId: 'pi_immutable',
    advertiser: advertiser(advertiserId, 'Delta'),
  });
  await recordConfirmedContribution(db, confirmed);
  await recordConfirmedContribution(
    db,
    record({
      advertiserId: otherAdvertiserId,
      sessionId: 'cs_test_immutable_other',
      paymentIntentId: 'pi_immutable_other',
      advertiser: advertiser(otherAdvertiserId, 'Foxtrot'),
    }),
  );

  for (const { name, sql, values } of [
    {
      name: 'record identity',
      sql: 'UPDATE contributions SET id = ? WHERE id = ?',
      values: [crypto.randomUUID(), confirmed.id],
    },
    {
      name: 'advertiser ownership',
      sql: 'UPDATE contributions SET advertiser_id = ? WHERE id = ?',
      values: [otherAdvertiserId, confirmed.id],
    },
    {
      name: 'gross and allocated cents',
      sql: `UPDATE contributions
            SET gross_amount_cents = ?, charity_amount_cents = ?, platform_amount_cents = ?
            WHERE id = ?`,
      values: [1_001, 901, 100, confirmed.id],
    },
    {
      name: 'allocation percentages',
      sql: `UPDATE contributions
            SET charity_percentage = ?, platform_percentage = ?
            WHERE id = ?`,
      values: [89, 11, confirmed.id],
    },
    {
      name: 'charity name',
      sql: 'UPDATE contributions SET charity_name = ? WHERE id = ?',
      values: ['Different Charity', confirmed.id],
    },
    {
      name: 'charity EIN',
      sql: 'UPDATE contributions SET charity_ein = ? WHERE id = ?',
      values: ['98-7654321', confirmed.id],
    },
    {
      name: 'Stripe Checkout provenance',
      sql: 'UPDATE contributions SET stripe_checkout_session_id = ? WHERE id = ?',
      values: ['cs_test_changed', confirmed.id],
    },
    {
      name: 'Stripe Payment Intent provenance',
      sql: 'UPDATE contributions SET stripe_payment_intent_id = ? WHERE id = ?',
      values: ['pi_changed', confirmed.id],
    },
    {
      name: 'confirmation time',
      sql: 'UPDATE contributions SET created_at = ? WHERE id = ?',
      values: ['2030-01-01T00:00:00.000Z', confirmed.id],
    },
  ]) {
    await assert.rejects(() => db.prepare(sql).bind(...values).run(), name);
  }

  await assert.rejects(
    () => db.prepare('DELETE FROM contributions WHERE id = ?').bind(confirmed.id).run(),
    'confirmed contribution deletion',
  );
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
  await db
    .prepare(
      `UPDATE contributions
       SET charity_delivery_status = 'delivered',
           charity_delivery_attempts = 0,
           goodapi_donation_id = 'donation-already-delivered'
       WHERE stripe_checkout_session_id = 'cs_test_delivery_00'`,
    )
    .run();

  const selected = await listUndeliveredContributions(db);
  assert.equal(selected.length, 25);
  assert.equal(
    selected.some(
      (contribution) =>
        contribution.stripe_checkout_session_id === 'cs_test_delivery_00',
    ),
    false,
  );
  assert.deepEqual(
    selected
      .slice(0, 2)
      .map((contribution) => contribution.stripe_checkout_session_id)
      .sort(),
    ['cs_test_delivery_25', 'cs_test_delivery_26'],
  );
  assert.equal(selected.filter((contribution) => contribution.charity_delivery_attempts === 10).length, 23);
});

test('suspension checks never let a missing payment intent hide other money or block other deliveries', async (context) => {
  const db = new TestD1Database();
  context.after(() => db.close());
  const advertiserId = '12121212-1212-4212-8212-121212121212';
  await recordConfirmedContribution(db, record({ advertiserId, sessionId: 'cs_a', paymentIntentId: 'pi_a', amount: 10_000, advertiser: advertiser(advertiserId, 'Golf') }));
  await recordConfirmedContribution(db, record({ advertiserId, sessionId: 'cs_b', paymentIntentId: 'pi_b', amount: 20_000 }));
  // A legacy row with no payment intent at all (only reachable by hand; the webhook refuses it).
  await recordConfirmedContribution(db, record({ advertiserId, sessionId: 'cs_null', paymentIntentId: null, amount: 30_000 }));
  await db.prepare("INSERT INTO payment_suspensions (stripe_payment_intent_id, reason) VALUES ('pi_b', 'test')").run();

  const board = await getLeaderboard(db);
  assert.equal(board.grossCents, 40_000, 'only the suspended payment is excluded');
  const deliverable = (await listUndeliveredContributions(db)).map((row) => row.stripe_checkout_session_id).sort();
  assert.deepEqual(deliverable, ['cs_a', 'cs_null']);

  await assert.rejects(
    () => db.prepare("INSERT INTO payment_suspensions (stripe_payment_intent_id, reason) VALUES (NULL, 'test')").run(),
    'a suspension without a payment intent is refused by the schema',
  );
  await assert.rejects(
    () => db.prepare("INSERT INTO payment_suspensions (stripe_payment_intent_id, reason) VALUES ('', 'test')").run(),
  );
});

test('a listing rank total counts only money that has not been refunded or disputed', async (context) => {
  const db = new TestD1Database();
  context.after(() => db.close());
  const leaderId = '13131313-1313-4313-8313-131313131313';
  const rivalId = '14141414-1414-4414-8414-141414141414';
  await recordConfirmedContribution(db, record({ advertiserId: leaderId, sessionId: 'cs_l1', paymentIntentId: 'pi_l1', amount: 10_000, advertiser: advertiser(leaderId, 'Leader') }));
  await recordConfirmedContribution(db, record({ advertiserId: leaderId, sessionId: 'cs_l2', paymentIntentId: 'pi_l2', amount: 10_000 }));
  await recordConfirmedContribution(db, record({ advertiserId: rivalId, sessionId: 'cs_r1', paymentIntentId: 'pi_r1', amount: 15_000, advertiser: advertiser(rivalId, 'Rival') }));
  const total = async (id) =>
    (await db.prepare('SELECT total_contributed_cents AS t FROM advertisers WHERE id = ?').bind(id).first()).t;
  assert.equal(await total(leaderId), 20_000);

  // A refund on one payment drops that payment from the rank total and reorders the board.
  await db.prepare("INSERT INTO payment_suspensions (stripe_payment_intent_id, reason) VALUES ('pi_l2', 'charge.refunded')").run();
  assert.equal(await total(leaderId), 10_000);
  assert.equal(await total(rivalId), 15_000);
  assert.deepEqual((await getLeaderboard(db)).advertisers.map((row) => row.name), ['Rival', 'Leader']);

  // A later confirmation for an already-suspended payment never adds to the total either.
  await db.prepare("INSERT INTO payment_suspensions (stripe_payment_intent_id, reason) VALUES ('pi_l3', 'charge.refunded')").run();
  await recordConfirmedContribution(db, record({ advertiserId: leaderId, sessionId: 'cs_l3', paymentIntentId: 'pi_l3', amount: 50_000 }));
  assert.equal(await total(leaderId), 10_000);

  // Confirming a suspended payment also hid the listing pending review.
  assert.deepEqual((await getLeaderboard(db)).advertisers.map((row) => row.name), ['Rival']);

  // Lifting a suspension (a won dispute) restores the money to the rank total; visibility is
  // still Kyle's manual review decision.
  await db.prepare("DELETE FROM payment_suspensions WHERE stripe_payment_intent_id = 'pi_l2'").run();
  assert.equal(await total(leaderId), 20_000);
  await db.prepare('UPDATE advertisers SET is_hidden = 0 WHERE id = ?').bind(leaderId).run();
  assert.deepEqual((await getLeaderboard(db)).advertisers.map((row) => row.name), ['Leader', 'Rival']);
});
