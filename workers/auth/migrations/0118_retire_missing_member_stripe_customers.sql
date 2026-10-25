-- A deleted Stripe customer cannot be rewritten in place: member customer
-- identity is immutable. retired_at keeps the old ref and lets Checkout link
-- the replacement without treating the missing id as the active customer.
ALTER TABLE billing_member_customers ADD COLUMN retired_at TEXT;
