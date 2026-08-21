PRAGMA foreign_keys = ON;

CREATE TABLE advertisers (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 140),
  url TEXT NOT NULL CHECK (length(url) BETWEEN 8 AND 400),
  logo_key TEXT NOT NULL,
  x_handle TEXT,
  management_token_hash TEXT NOT NULL UNIQUE,
  total_contributed_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_contributed_cents >= 0),
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX advertisers_rank_idx
  ON advertisers(is_hidden, total_contributed_cents DESC, created_at ASC, id ASC);

CREATE TABLE contributions (
  id TEXT PRIMARY KEY,
  advertiser_id TEXT NOT NULL REFERENCES advertisers(id),
  gross_amount_cents INTEGER NOT NULL CHECK (gross_amount_cents > 0),
  charity_amount_cents INTEGER NOT NULL CHECK (charity_amount_cents > 0),
  platform_amount_cents INTEGER NOT NULL CHECK (platform_amount_cents >= 0),
  charity_percentage INTEGER NOT NULL CHECK (charity_percentage BETWEEN 1 AND 100),
  platform_percentage INTEGER NOT NULL CHECK (platform_percentage BETWEEN 0 AND 99),
  charity_name TEXT NOT NULL,
  charity_ein TEXT NOT NULL,
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  goodapi_donation_id TEXT UNIQUE,
  charity_delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (charity_delivery_status IN ('pending', 'delivered', 'failed')),
  charity_delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (charity_delivery_attempts >= 0),
  charity_delivery_error TEXT,
  charity_delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (charity_amount_cents + platform_amount_cents = gross_amount_cents),
  CHECK (charity_percentage + platform_percentage = 100)
);

CREATE INDEX contributions_advertiser_idx
  ON contributions(advertiser_id, created_at ASC);

CREATE INDEX contributions_delivery_idx
  ON contributions(
    charity_delivery_status,
    charity_delivery_attempts ASC,
    created_at ASC,
    id ASC
  );

CREATE TRIGGER contributions_update_advertiser_total
AFTER INSERT ON contributions
BEGIN
  UPDATE advertisers
  SET total_contributed_cents = (
        SELECT COALESCE(SUM(gross_amount_cents), 0)
        FROM contributions
        WHERE advertiser_id = NEW.advertiser_id
      ),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.advertiser_id;
END;

CREATE TRIGGER contributions_protect_financial_fields
BEFORE UPDATE ON contributions
WHEN NEW.id != OLD.id
  OR NEW.advertiser_id != OLD.advertiser_id
  OR NEW.gross_amount_cents != OLD.gross_amount_cents
  OR NEW.charity_amount_cents != OLD.charity_amount_cents
  OR NEW.platform_amount_cents != OLD.platform_amount_cents
  OR NEW.charity_percentage != OLD.charity_percentage
  OR NEW.platform_percentage != OLD.platform_percentage
  OR NEW.charity_name != OLD.charity_name
  OR NEW.charity_ein != OLD.charity_ein
  OR NEW.stripe_checkout_session_id != OLD.stripe_checkout_session_id
  OR NOT (NEW.stripe_payment_intent_id IS OLD.stripe_payment_intent_id)
  OR NEW.created_at != OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'confirmed contribution financial fields are immutable');
END;

CREATE TRIGGER contributions_prevent_delete
BEFORE DELETE ON contributions
BEGIN
  SELECT RAISE(ABORT, 'confirmed contributions cannot be deleted');
END;
