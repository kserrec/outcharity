-- A listing's rank total counts only money that has not been refunded or disputed. The total is
-- recomputed whenever a contribution is confirmed or a suspension is recorded or lifted.
DROP TRIGGER contributions_update_advertiser_total;

CREATE TRIGGER contributions_update_advertiser_total
AFTER INSERT ON contributions
BEGIN
  UPDATE advertisers
  SET total_contributed_cents = (
        SELECT COALESCE(SUM(c.gross_amount_cents), 0)
        FROM contributions c
        WHERE c.advertiser_id = NEW.advertiser_id
          AND NOT EXISTS (
            SELECT 1 FROM payment_suspensions s
            WHERE s.stripe_payment_intent_id = c.stripe_payment_intent_id
          )
      ),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.advertiser_id;
END;

CREATE TRIGGER payment_suspensions_update_advertiser_total_insert
AFTER INSERT ON payment_suspensions
BEGIN
  UPDATE advertisers
  SET total_contributed_cents = (
        SELECT COALESCE(SUM(c.gross_amount_cents), 0)
        FROM contributions c
        WHERE c.advertiser_id = advertisers.id
          AND NOT EXISTS (
            SELECT 1 FROM payment_suspensions s
            WHERE s.stripe_payment_intent_id = c.stripe_payment_intent_id
          )
      ),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id IN (
    SELECT advertiser_id FROM contributions
    WHERE stripe_payment_intent_id = NEW.stripe_payment_intent_id
  );
END;

CREATE TRIGGER payment_suspensions_update_advertiser_total_delete
AFTER DELETE ON payment_suspensions
BEGIN
  UPDATE advertisers
  SET total_contributed_cents = (
        SELECT COALESCE(SUM(c.gross_amount_cents), 0)
        FROM contributions c
        WHERE c.advertiser_id = advertisers.id
          AND NOT EXISTS (
            SELECT 1 FROM payment_suspensions s
            WHERE s.stripe_payment_intent_id = c.stripe_payment_intent_id
          )
      ),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id IN (
    SELECT advertiser_id FROM contributions
    WHERE stripe_payment_intent_id = OLD.stripe_payment_intent_id
  );
END;
