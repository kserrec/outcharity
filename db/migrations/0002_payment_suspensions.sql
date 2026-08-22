-- Refund and dispute events may arrive before the payment's own confirmation event. Recording
-- the payment intent here lets a later confirmation land already hidden.
CREATE TABLE payment_suspensions (
  stripe_payment_intent_id TEXT PRIMARY KEY NOT NULL CHECK (stripe_payment_intent_id != ''),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
