-- Fresh Kasa POS schema for Cloudflare D1 / SQLite.
-- This starts a new database. It deliberately does not import Supabase data.
-- Business amounts are integer GHS pesewas; no raw card data is stored.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  platform_role TEXT NOT NULL DEFAULT 'user' CHECK (platform_role IN ('user','platform_admin')),
  email_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'GH' CHECK (length(country_code) = 2),
  base_currency TEXT NOT NULL DEFAULT 'GHS' CHECK (length(base_currency) = 3),
  timezone TEXT NOT NULL DEFAULT 'Africa/Accra',
  tax_registration_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (tax_registration_status IN ('unverified','not_registered','registered','e_vat_onboarded')),
  tax_registration_number TEXT,
  e_vat_status TEXT NOT NULL DEFAULT 'not_configured'
    CHECK (e_vat_status IN ('not_configured','pending','approved','rejected')),
  settings TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (id, base_currency)
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  auth_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  email TEXT COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','cashier')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','disabled')),
  refund_limit_minor INTEGER DEFAULT 0 CHECK ((refund_limit_minor IS NULL AND role = 'owner') OR (refund_limit_minor IS NOT NULL AND refund_limit_minor >= 0)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (store_id, id),
  UNIQUE (store_id, auth_user_id),
  UNIQUE (store_id, email)
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  device_name TEXT NOT NULL,
  platform TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  enrolled_by TEXT,
  last_seen_at TEXT,
  last_sync_cursor TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at TEXT,
  UNIQUE (store_id, id),
  FOREIGN KEY (store_id, enrolled_by) REFERENCES employees(store_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (store_id, id),
  UNIQUE (store_id, name)
);

CREATE TABLE IF NOT EXISTS tax_categories (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  treatment TEXT NOT NULL CHECK (treatment IN ('standard_rated','zero_rated','exempt','out_of_scope')),
  jurisdiction_code TEXT NOT NULL DEFAULT 'GH',
  default_price_mode TEXT NOT NULL DEFAULT 'inclusive' CHECK (default_price_mode IN ('inclusive','exclusive')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  effective_from TEXT NOT NULL DEFAULT (date('now')),
  effective_to TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (store_id, id),
  UNIQUE (store_id, code),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS tax_rates (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  tax_category_id TEXT NOT NULL,
  component_code TEXT NOT NULL,
  component_name TEXT NOT NULL,
  rate_percent REAL NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  calculation_method TEXT NOT NULL DEFAULT 'same_base' CHECK (calculation_method IN ('same_base','compound')),
  calculation_order INTEGER NOT NULL DEFAULT 1 CHECK (calculation_order > 0),
  effective_from TEXT NOT NULL DEFAULT (date('now')),
  effective_to TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (store_id, id),
  FOREIGN KEY (store_id, tax_category_id) REFERENCES tax_categories(store_id, id) ON DELETE RESTRICT,
  UNIQUE (store_id, tax_category_id, component_code, effective_from),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  category_id TEXT,
  tax_category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  unit_name TEXT NOT NULL DEFAULT 'each',
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  currency_code TEXT NOT NULL DEFAULT 'GHS' CHECK (length(currency_code) = 3),
  price_mode TEXT NOT NULL DEFAULT 'inclusive' CHECK (price_mode IN ('inclusive','exclusive')),
  tax_rate REAL CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 100)),
  track_inventory INTEGER NOT NULL DEFAULT 1 CHECK (track_inventory IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (store_id, id),
  UNIQUE (store_id, sku),
  FOREIGN KEY (store_id, category_id) REFERENCES categories(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, tax_category_id) REFERENCES tax_categories(store_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  display_name TEXT,
  email TEXT,
  phone TEXT,
  receipt_contact_only INTEGER NOT NULL DEFAULT 1 CHECK (receipt_contact_only IN (0,1)),
  marketing_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (marketing_opt_in IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  UNIQUE (store_id, id)
);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  device_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','exception')),
  currency_code TEXT NOT NULL DEFAULT 'GHS',
  opening_float INTEGER NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
  expected_cash INTEGER,
  counted_cash INTEGER,
  variance_amount INTEGER,
  variance_reason TEXT,
  opened_at_device TEXT,
  opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_at_device TEXT,
  closed_at TEXT,
  closed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (store_id, id),
  FOREIGN KEY (store_id, device_id) REFERENCES devices(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, employee_id) REFERENCES employees(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, closed_by) REFERENCES employees(store_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  device_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  shift_id TEXT,
  customer_id TEXT,
  client_order_id TEXT NOT NULL,
  order_number TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_payment','paid','partially_refunded','refunded','voided')),
  currency_code TEXT NOT NULL DEFAULT 'GHS',
  subtotal_amount INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  tax_amount INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  tax_snapshot TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(tax_snapshot)),
  local_created_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  paid_at TEXT,
  UNIQUE (store_id, id),
  UNIQUE (store_id, device_id, client_order_id),
  FOREIGN KEY (store_id, device_id) REFERENCES devices(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, employee_id) REFERENCES employees(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, customer_id) REFERENCES customers(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, shift_id) REFERENCES shifts(store_id, id) ON DELETE RESTRICT,
  CHECK (total_amount = subtotal_amount + tax_amount)
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL,
  product_id TEXT,
  product_name_snapshot TEXT NOT NULL,
  sku_snapshot TEXT,
  tax_category_name_snapshot TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  currency_code TEXT NOT NULL DEFAULT 'GHS',
  price_mode TEXT NOT NULL CHECK (price_mode IN ('inclusive','exclusive')),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  line_subtotal INTEGER NOT NULL CHECK (line_subtotal >= 0),
  tax_rate REAL NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  tax_amount INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total INTEGER NOT NULL CHECK (line_total >= 0),
  calculation_version TEXT NOT NULL DEFAULT 'tax-core-v1',
  tax_snapshot TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tax_snapshot)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (store_id, id),
  FOREIGN KEY (store_id, order_id) REFERENCES orders(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, product_id) REFERENCES products(store_id, id) ON DELETE RESTRICT,
  CHECK (line_total = line_subtotal + tax_amount)
);

CREATE TABLE IF NOT EXISTS order_item_taxes (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  order_item_id TEXT NOT NULL,
  tax_rate_id TEXT,
  component_code TEXT NOT NULL,
  component_name_snapshot TEXT NOT NULL,
  rate_percent REAL NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  taxable_base_amount INTEGER NOT NULL CHECK (taxable_base_amount >= 0),
  tax_amount INTEGER NOT NULL CHECK (tax_amount >= 0),
  calculation_method TEXT NOT NULL CHECK (calculation_method IN ('same_base','compound')),
  calculation_order INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (store_id, order_item_id) REFERENCES order_items(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, tax_rate_id) REFERENCES tax_rates(store_id, id) ON DELETE RESTRICT,
  UNIQUE (store_id, order_item_id, component_code)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','card','momo')),
  provider TEXT,
  provider_network TEXT,
  provider_reference TEXT,
  provider_transaction_id TEXT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('initiated','pending','confirmed','failed','partially_refunded','refunded')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency_code TEXT NOT NULL DEFAULT 'GHS',
  customer_phone_last4 TEXT,
  provider_metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provider_metadata)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  confirmed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (store_id, id),
  UNIQUE (store_id, idempotency_key),
  FOREIGN KEY (store_id, order_id) REFERENCES orders(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, device_id) REFERENCES devices(store_id, id) ON DELETE RESTRICT,
  CHECK ((method = 'cash' AND provider IS NULL) OR (method IN ('card','momo') AND provider IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  device_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','pending','processing','needs_attention','processed','failed')),
  reason TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  tax_amount INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  currency_code TEXT NOT NULL DEFAULT 'GHS',
  provider_refund_id TEXT,
  provider_reference TEXT,
  offline_created_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (store_id, id),
  UNIQUE (store_id, idempotency_key),
  FOREIGN KEY (store_id, order_id) REFERENCES orders(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, payment_id) REFERENCES payments(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, requested_by) REFERENCES employees(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, approved_by) REFERENCES employees(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, device_id) REFERENCES devices(store_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS refund_items (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  refund_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  restock INTEGER NOT NULL DEFAULT 1 CHECK (restock IN (0,1)),
  item_amount INTEGER NOT NULL CHECK (item_amount >= 0),
  tax_amount INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (store_id, refund_id) REFERENCES refunds(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, order_item_id) REFERENCES order_items(store_id, id) ON DELETE RESTRICT,
  UNIQUE (store_id, refund_id, order_item_id)
);

CREATE TABLE IF NOT EXISTS refund_item_taxes (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  refund_item_id TEXT NOT NULL,
  component_code TEXT NOT NULL,
  component_name_snapshot TEXT NOT NULL,
  rate_percent REAL NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  taxable_base_amount INTEGER NOT NULL CHECK (taxable_base_amount >= 0),
  tax_amount INTEGER NOT NULL CHECK (tax_amount >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (store_id, refund_item_id) REFERENCES refund_items(store_id, id) ON DELETE RESTRICT,
  UNIQUE (store_id, refund_item_id, component_code)
);

CREATE TABLE IF NOT EXISTS inventory (
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL,
  quantity_on_hand REAL NOT NULL DEFAULT 0,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version > 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (store_id, product_id),
  FOREIGN KEY (store_id, product_id) REFERENCES products(store_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('sale','return','receive','count_adjustment','damage','opening_balance')),
  quantity_delta REAL NOT NULL CHECK (quantity_delta <> 0),
  base_inventory_version INTEGER,
  client_event_id TEXT NOT NULL,
  order_id TEXT,
  refund_id TEXT,
  reason TEXT,
  occurred_at_device TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (store_id, product_id) REFERENCES products(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, device_id) REFERENCES devices(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, employee_id) REFERENCES employees(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, order_id) REFERENCES orders(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, refund_id) REFERENCES refunds(store_id, id) ON DELETE RESTRICT,
  UNIQUE (store_id, device_id, client_event_id)
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  business_date TEXT NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'GHS',
  gross_sales INTEGER NOT NULL DEFAULT 0,
  refunds_total INTEGER NOT NULL DEFAULT 0,
  net_sales INTEGER NOT NULL DEFAULT 0,
  tax_total INTEGER NOT NULL DEFAULT 0,
  tender_totals TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(tender_totals)),
  tax_component_totals TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(tax_component_totals)),
  metrics TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metrics)),
  source_cursor TEXT,
  generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (store_id, business_date, currency_code)
);

CREATE TABLE IF NOT EXISTS sync_events (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  device_id TEXT NOT NULL,
  employee_id TEXT,
  client_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result_status TEXT NOT NULL DEFAULT 'accepted' CHECK (result_status IN ('processing','accepted','rejected','conflict')),
  result_reference TEXT,
  response_summary TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(response_summary)),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (store_id, device_id, client_event_id),
  FOREIGN KEY (store_id, device_id) REFERENCES devices(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, employee_id) REFERENCES employees(store_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('paystack','flutterwave')),
  provider_event_id TEXT NOT NULL,
  store_id TEXT,
  payment_id TEXT,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  signature_verified INTEGER NOT NULL DEFAULT 0 CHECK (signature_verified IN (0,1)),
  processing_status TEXT NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processed','ignored','failed')),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed_at TEXT,
  UNIQUE (provider, provider_event_id),
  FOREIGN KEY (store_id, payment_id) REFERENCES payments(store_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS privacy_consent_events (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  purpose_code TEXT NOT NULL CHECK (purpose_code IN ('digital_payment_contact','receipt_email')),
  policy_version TEXT NOT NULL,
  consented_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (store_id, order_id) REFERENCES orders(store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id, employee_id) REFERENCES employees(store_id, id) ON DELETE RESTRICT,
  UNIQUE (store_id, order_id, purpose_code, policy_version)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_email_tokens (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset','invite')),
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE,
  user_id TEXT REFERENCES auth_users(id) ON DELETE CASCADE,
  employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_started_ms INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  blocked_until_ms INTEGER
);

CREATE INDEX IF NOT EXISTS employees_store_status_idx ON employees(store_id, status, role);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS auth_tokens_email_purpose_idx ON auth_email_tokens(email, purpose, expires_at);
CREATE INDEX IF NOT EXISTS products_store_active_idx ON products(store_id, active, name);
CREATE INDEX IF NOT EXISTS products_store_category_idx ON products(store_id, category_id, active);
CREATE INDEX IF NOT EXISTS tax_rates_effective_idx ON tax_rates(store_id, tax_category_id, effective_from, effective_to, active);
CREATE INDEX IF NOT EXISTS orders_store_created_idx ON orders(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_store_status_idx ON orders(store_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(store_id, order_id);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments(store_id, order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refunds_order_idx ON refunds(store_id, order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_product_idx ON inventory_movements(store_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS daily_reports_date_idx ON daily_reports(store_id, business_date DESC);
CREATE INDEX IF NOT EXISTS sync_events_device_received_idx ON sync_events(store_id, device_id, received_at DESC);
CREATE INDEX IF NOT EXISTS payment_webhooks_payment_idx ON payment_webhook_events(store_id, payment_id, received_at DESC);
CREATE INDEX IF NOT EXISTS privacy_consent_events_order_idx ON privacy_consent_events(store_id, order_id, consented_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_shift_per_device_idx ON shifts(store_id, device_id) WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS one_successful_tender_per_order_idx ON payments(store_id, order_id) WHERE status IN ('confirmed','partially_refunded','refunded');
CREATE UNIQUE INDEX IF NOT EXISTS provider_reference_idx ON payments(provider, provider_reference) WHERE provider_reference IS NOT NULL;
