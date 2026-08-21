export async function getLeaderboard(db) {
  const result = await db
    .prepare(
      `WITH totals AS (
         SELECT
           COALESCE(SUM(gross_amount_cents), 0) AS gross_cents,
           COALESCE(SUM(charity_amount_cents), 0) AS charity_cents
         FROM contributions
       )
       SELECT
         a.id,
         a.name,
         a.description,
         a.url,
         a.logo_key,
         a.total_contributed_cents,
         a.created_at,
         totals.gross_cents,
         totals.charity_cents
       FROM totals
       LEFT JOIN advertisers a
         ON a.total_contributed_cents > 0 AND a.is_hidden = 0
       ORDER BY a.total_contributed_cents DESC, a.created_at ASC, a.id ASC`,
    )
    .all();
  const rows = result.results || [];
  const advertisers = rows
    .filter((row) => row.id !== null)
    .map(({ gross_cents: _grossCents, charity_cents: _charityCents, ...advertiser }) => advertiser);

  return {
    advertisers,
    grossCents: Number(rows[0]?.gross_cents || 0),
    charityCents: Number(rows[0]?.charity_cents || 0),
  };
}

export async function findAdvertiserByTokenHash(db, tokenHash) {
  return db
    .prepare(
      `SELECT
         a.*,
         CASE
           WHEN a.is_hidden = 1 OR a.total_contributed_cents = 0 THEN NULL
           ELSE 1 + (
             SELECT COUNT(*)
             FROM advertisers ahead
             WHERE ahead.is_hidden = 0
               AND ahead.total_contributed_cents > 0
               AND (
                 ahead.total_contributed_cents > a.total_contributed_cents
                 OR (
                   ahead.total_contributed_cents = a.total_contributed_cents
                   AND (
                     ahead.created_at < a.created_at
                     OR (ahead.created_at = a.created_at AND ahead.id < a.id)
                   )
                 )
               )
           )
         END AS rank
       FROM advertisers a
       WHERE a.management_token_hash = ?`,
    )
    .bind(tokenHash)
    .first();
}

export async function getContributionBySession(db, sessionId) {
  return db
    .prepare(
      `SELECT
         c.*,
         a.name,
         a.description,
         a.url,
         a.logo_key,
         a.total_contributed_cents,
         a.management_token_hash,
         a.is_hidden,
         CASE
           WHEN a.is_hidden = 1 THEN NULL
           ELSE 1 + (
             SELECT COUNT(*)
             FROM advertisers ahead
             WHERE ahead.is_hidden = 0
               AND ahead.total_contributed_cents > 0
               AND (
                 ahead.total_contributed_cents > a.total_contributed_cents
                 OR (
                   ahead.total_contributed_cents = a.total_contributed_cents
                   AND (
                     ahead.created_at < a.created_at
                     OR (ahead.created_at = a.created_at AND ahead.id < a.id)
                   )
                 )
               )
           )
         END AS rank
       FROM contributions c
       JOIN advertisers a ON a.id = c.advertiser_id
       WHERE c.stripe_checkout_session_id = ?`,
    )
    .bind(sessionId)
    .first();
}

export async function isPublicLogo(db, logoKey) {
  const match = /^logos\/([0-9a-f-]{36})\.(?:png|jpg|webp)$/i.exec(logoKey);
  if (!match) return false;
  const advertiser = await db
    .prepare(
      `SELECT 1 AS visible
       FROM advertisers
       WHERE id = ?
         AND logo_key = ?
         AND is_hidden = 0
         AND total_contributed_cents > 0`,
    )
    .bind(match[1].toLowerCase(), logoKey)
    .first();
  return advertiser?.visible === 1;
}

export async function recordConfirmedContribution(db, record) {
  const statements = [];
  if (record.advertiser) {
    statements.push(
      db
        .prepare(
          `INSERT INTO advertisers (
             id, slug, name, description, url, logo_key, x_handle, management_token_hash
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
        )
        .bind(
          record.advertiser.id,
          record.advertiser.slug,
          record.advertiser.name,
          record.advertiser.description,
          record.advertiser.url,
          record.advertiser.logoKey,
          record.advertiser.xHandle,
          record.advertiser.managementTokenHash,
        ),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO contributions (
           id,
           advertiser_id,
           gross_amount_cents,
           charity_amount_cents,
           platform_amount_cents,
           charity_percentage,
           platform_percentage,
           charity_name,
           charity_ein,
           stripe_checkout_session_id,
           stripe_payment_intent_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(stripe_checkout_session_id) DO NOTHING`,
      )
      .bind(
        record.id,
        record.advertiserId,
        record.grossCents,
        record.charityCents,
        record.platformCents,
        record.charityPercentage,
        record.platformPercentage,
        record.charityName,
        record.charityEin,
        record.stripeCheckoutSessionId,
        record.stripePaymentIntentId,
      ),
  );

  const results = await db.batch(statements);
  const contributionResult = results.at(-1);
  const contribution = await getContributionBySession(db, record.stripeCheckoutSessionId);
  return {
    inserted: Number(contributionResult?.meta?.changes || 0) === 1,
    contribution,
  };
}

export async function listUndeliveredContributions(db, limit = 25) {
  const result = await db
    .prepare(
      `SELECT *
       FROM contributions
       WHERE charity_delivery_status IN ('pending', 'failed')
       ORDER BY charity_delivery_attempts ASC, created_at ASC, id ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all();
  return result.results || [];
}

export async function markCharityDelivered(db, contributionId, donationId) {
  return db
    .prepare(
      `UPDATE contributions
       SET goodapi_donation_id = ?,
           charity_delivery_status = 'delivered',
           charity_delivery_attempts = charity_delivery_attempts + 1,
           charity_delivery_error = NULL,
           charity_delivered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND charity_delivery_status != 'delivered'`,
    )
    .bind(donationId, contributionId)
    .run();
}

export async function markCharityDeliveryFailed(db, contributionId, message) {
  return db
    .prepare(
      `UPDATE contributions
       SET charity_delivery_status = 'failed',
           charity_delivery_attempts = charity_delivery_attempts + 1,
           charity_delivery_error = ?
       WHERE id = ? AND charity_delivery_status != 'delivered'`,
    )
    .bind(String(message).slice(0, 500), contributionId)
    .run();
}
