-- POS MVP starter schema for Supabase PostgreSQL.
-- Cloud business data stays in PostgreSQL. Dexie/IndexedDB is the required device-local PWA store.
-- Run as a reviewed Supabase migration; do not paste directly into production without testing.

begin;

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country_code char(2) not null default 'GH',
  base_currency char(3) not null default 'GHS',
  timezone text not null default 'Africa/Accra',
  tax_registration_status text not null default 'unverified'
    check (tax_registration_status in ('unverified','not_registered','registered','e_vat_onboarded')),
  tax_registration_number text,
  e_vat_status text not null default 'not_configured'
    check (e_vat_status in ('not_configured','pending','approved','rejected')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, base_currency)
);

-- Supabase Auth stores credentials; this table stores POS employee identity and role only.
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  auth_user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  email text,
  role text not null check (role in ('owner','manager','cashier')),
  status text not null default 'active' check (status in ('invited','active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, auth_user_id)
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  device_name text not null,
  platform text,
  status text not null default 'active' check (status in ('active','revoked')),
  enrolled_by uuid,
  last_seen_at timestamptz,
  last_sync_cursor text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (store_id, id),
  foreign key (store_id, enrolled_by) references public.employees(store_id, id) on delete restrict
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, name)
);

create table if not exists public.tax_categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  code text not null,
  name text not null,
  treatment text not null
    check (treatment in ('standard_rated','zero_rated','exempt','out_of_scope')),
  jurisdiction_code char(2) not null default 'GH',
  default_price_mode text not null default 'inclusive'
    check (default_price_mode in ('inclusive','exclusive')),
  active boolean not null default true,
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, code),
  check (effective_to is null or effective_to >= effective_from)
);

-- One row per component/rate version (for example VAT, NHIL and GETFund).
-- Do not update a rate used by a past sale; add a new effective-dated row instead.
create table if not exists public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  tax_category_id uuid not null,
  component_code text not null,
  component_name text not null,
  rate_percent numeric(9,6) not null check (rate_percent >= 0 and rate_percent <= 100),
  calculation_method text not null default 'same_base'
    check (calculation_method in ('same_base','compound')),
  calculation_order smallint not null default 1 check (calculation_order > 0),
  effective_from date not null default current_date,
  effective_to date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_id, id),
  foreign key (store_id, tax_category_id)
    references public.tax_categories(store_id, id) on delete restrict,
  unique (store_id, tax_category_id, component_code, effective_from),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  category_id uuid,
  tax_category_id uuid not null,
  name text not null,
  sku text,
  unit_name text not null default 'each',
  price_minor bigint not null check (price_minor >= 0),
  currency_code char(3) not null default 'GHS',
  price_mode text not null default 'inclusive' check (price_mode in ('inclusive','exclusive')),
  -- Optional single-component product override. NULL means use tax_category_id + tax_rates.
  -- For Ghana's composite tax profile, use the category components; do not put 20% here
  -- and also apply VAT/NHIL/GETFund components.
  tax_rate numeric(9,6) check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 100)),
  track_inventory boolean not null default true,
  active boolean not null default true,
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, sku),
  foreign key (store_id, category_id) references public.categories(store_id, id) on delete restrict,
  foreign key (store_id, tax_category_id) references public.tax_categories(store_id, id) on delete restrict,
  check (currency_code = 'GHS' or currency_code ~ '^[A-Z]{3}$')
);

-- Included as requested, but MVP does not expose loyalty/CRM. Contact is optional and minimal.
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  display_name text,
  email text,
  phone text,
  receipt_contact_only boolean not null default true,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (store_id, id)
);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  device_id uuid not null,
  employee_id uuid not null,
  status text not null default 'open' check (status in ('open','closed','exception')),
  currency_code char(3) not null default 'GHS',
  opening_float bigint not null default 0 check (opening_float >= 0),
  expected_cash bigint,
  counted_cash bigint,
  variance_amount bigint,
  variance_reason text,
  opened_at_device timestamptz,
  opened_at timestamptz not null default now(),
  closed_at_device timestamptz,
  closed_at timestamptz,
  closed_by uuid,
  created_at timestamptz not null default now(),
  unique (store_id, id),
  foreign key (store_id, device_id) references public.devices(store_id, id) on delete restrict,
  foreign key (store_id, employee_id) references public.employees(store_id, id) on delete restrict,
  foreign key (store_id, closed_by) references public.employees(store_id, id) on delete restrict
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  device_id uuid not null,
  employee_id uuid not null,
  shift_id uuid,
  customer_id uuid,
  client_order_id uuid not null,
  order_number text,
  status text not null default 'draft'
    check (status in ('draft','pending_payment','paid','partially_refunded','refunded','voided')),
  currency_code char(3) not null default 'GHS',
  -- subtotal is net taxable base; MVP has no discount/tender-split columns.
  subtotal_amount bigint not null default 0,
  tax_amount bigint not null default 0,
  total_amount bigint not null default 0,
  tax_snapshot jsonb not null default '{}'::jsonb,
  local_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (store_id, id),
  unique (store_id, device_id, client_order_id),
  foreign key (store_id, device_id) references public.devices(store_id, id) on delete restrict,
  foreign key (store_id, employee_id) references public.employees(store_id, id) on delete restrict,
  foreign key (store_id, customer_id) references public.customers(store_id, id) on delete restrict,
  foreign key (store_id, shift_id) references public.shifts(store_id, id) on delete restrict,
  check (subtotal_amount >= 0 and tax_amount >= 0 and total_amount >= 0),
  check (total_amount = subtotal_amount + tax_amount)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  order_id uuid not null,
  product_id uuid,
  product_name_snapshot text not null,
  sku_snapshot text,
  tax_category_name_snapshot text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  currency_code char(3) not null default 'GHS',
  price_mode text not null check (price_mode in ('inclusive','exclusive')),
  unit_price bigint not null check (unit_price >= 0),
  line_subtotal bigint not null check (line_subtotal >= 0),
  -- Requested per-line snapshot fields; amounts are integer minor units and rate is percent.
  tax_rate numeric(9,6) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  line_total bigint not null check (line_total >= 0),
  calculation_version text not null default 'tax-core-v1',
  tax_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (store_id, id),
  foreign key (store_id, order_id) references public.orders(store_id, id) on delete restrict,
  foreign key (store_id, product_id) references public.products(store_id, id) on delete restrict,
  check (line_total = line_subtotal + tax_amount)
);

-- Per-component tax details for a composite rate; snapshots survive later rate changes.
create table if not exists public.order_item_taxes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  order_item_id uuid not null,
  tax_rate_id uuid,
  component_code text not null,
  component_name_snapshot text not null,
  rate_percent numeric(9,6) not null check (rate_percent >= 0 and rate_percent <= 100),
  taxable_base_amount bigint not null check (taxable_base_amount >= 0),
  tax_amount bigint not null check (tax_amount >= 0),
  calculation_method text not null check (calculation_method in ('same_base','compound')),
  calculation_order smallint not null default 1,
  created_at timestamptz not null default now(),
  foreign key (store_id, order_item_id) references public.order_items(store_id, id) on delete restrict,
  foreign key (store_id, tax_rate_id) references public.tax_rates(store_id, id) on delete restrict,
  unique (store_id, order_item_id, component_code)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  order_id uuid not null,
  device_id uuid not null,
  method text not null check (method in ('cash','card','momo')),
  provider text,
  provider_network text,
  provider_reference text,
  provider_transaction_id text,
  idempotency_key uuid not null,
  status text not null default 'pending'
    check (status in ('initiated','pending','confirmed','failed','partially_refunded','refunded')),
  amount bigint not null check (amount > 0),
  currency_code char(3) not null default 'GHS',
  customer_phone_last4 text,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, idempotency_key),
  foreign key (store_id, order_id) references public.orders(store_id, id) on delete restrict,
  foreign key (store_id, device_id) references public.devices(store_id, id) on delete restrict,
  check ((method = 'cash' and provider is null) or (method in ('card','momo') and provider is not null))
);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  order_id uuid not null,
  payment_id uuid not null,
  requested_by uuid not null,
  approved_by uuid,
  device_id uuid not null,
  idempotency_key uuid not null,
  status text not null default 'requested'
    check (status in ('requested','pending','processing','needs_attention','processed','failed')),
  reason text not null,
  amount bigint not null check (amount > 0),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  currency_code char(3) not null default 'GHS',
  provider_refund_id text,
  provider_reference text,
  offline_created_at timestamptz,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, idempotency_key),
  foreign key (store_id, order_id) references public.orders(store_id, id) on delete restrict,
  foreign key (store_id, payment_id) references public.payments(store_id, id) on delete restrict,
  foreign key (store_id, requested_by) references public.employees(store_id, id) on delete restrict,
  foreign key (store_id, approved_by) references public.employees(store_id, id) on delete restrict,
  foreign key (store_id, device_id) references public.devices(store_id, id) on delete restrict
);

create table if not exists public.refund_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  refund_id uuid not null,
  order_item_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  restock boolean not null default true,
  item_amount bigint not null check (item_amount >= 0),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  created_at timestamptz not null default now(),
  foreign key (store_id, refund_id) references public.refunds(store_id, id) on delete restrict,
  foreign key (store_id, order_item_id) references public.order_items(store_id, id) on delete restrict,
  unique (store_id, refund_id, order_item_id)
);

create table if not exists public.refund_item_taxes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  refund_item_id uuid not null,
  component_code text not null,
  component_name_snapshot text not null,
  rate_percent numeric(9,6) not null check (rate_percent >= 0 and rate_percent <= 100),
  taxable_base_amount bigint not null check (taxable_base_amount >= 0),
  tax_amount bigint not null check (tax_amount >= 0),
  created_at timestamptz not null default now(),
  foreign key (store_id, refund_item_id) references public.refund_items(store_id, id) on delete restrict,
  unique (store_id, refund_item_id, component_code)
);

-- Current stock is a projection. Signed movements are the sync/financial audit record.
create table if not exists public.inventory (
  store_id uuid not null references public.stores(id) on delete restrict,
  product_id uuid not null,
  quantity_on_hand numeric(14,3) not null default 0,
  row_version bigint not null default 1 check (row_version > 0),
  updated_at timestamptz not null default now(),
  primary key (store_id, product_id),
  foreign key (store_id, product_id) references public.products(store_id, id) on delete restrict
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  product_id uuid not null,
  device_id uuid not null,
  employee_id uuid not null,
  movement_type text not null
    check (movement_type in ('sale','return','receive','count_adjustment','damage','opening_balance')),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  base_inventory_version bigint,
  client_event_id uuid not null,
  order_id uuid,
  refund_id uuid,
  reason text,
  occurred_at_device timestamptz,
  created_at timestamptz not null default now(),
  foreign key (store_id, product_id) references public.products(store_id, id) on delete restrict,
  foreign key (store_id, device_id) references public.devices(store_id, id) on delete restrict,
  foreign key (store_id, employee_id) references public.employees(store_id, id) on delete restrict,
  foreign key (store_id, order_id) references public.orders(store_id, id) on delete restrict,
  foreign key (store_id, refund_id) references public.refunds(store_id, id) on delete restrict,
  unique (store_id, device_id, client_event_id)
);

create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  business_date date not null,
  currency_code char(3) not null default 'GHS',
  gross_sales bigint not null default 0,
  refunds_total bigint not null default 0,
  net_sales bigint not null default 0,
  tax_total bigint not null default 0,
  tender_totals jsonb not null default '{}'::jsonb,
  tax_component_totals jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  source_cursor text,
  generated_at timestamptz not null default now(),
  unique (store_id, business_date, currency_code)
);

-- Idempotency journal for local-to-cloud event retries. Full business event is stored in domain tables.
create table if not exists public.sync_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  device_id uuid not null,
  employee_id uuid,
  client_event_id uuid not null,
  event_type text not null,
  payload_hash text not null,
  result_status text not null default 'accepted'
    check (result_status in ('accepted','rejected','conflict')),
  result_reference uuid,
  response_summary jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  unique (store_id, device_id, client_event_id),
  foreign key (store_id, device_id) references public.devices(store_id, id) on delete restrict,
  foreign key (store_id, employee_id) references public.employees(store_id, id) on delete restrict
);

-- Only verified webhooks are recorded here; do not persist card data or provider secrets.
create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('paystack','flutterwave')),
  provider_event_id text not null,
  store_id uuid references public.stores(id) on delete restrict,
  payment_id uuid,
  event_type text not null,
  payload_hash text not null,
  signature_verified boolean not null default false,
  processing_status text not null default 'received'
    check (processing_status in ('received','processed','ignored','failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id),
  foreign key (store_id, payment_id) references public.payments(store_id, id) on delete restrict
);

-- Indexes for tablet checkout, transaction history, report and sync paths.
create index if not exists products_store_active_idx
  on public.products(store_id, active, name);
create index if not exists products_store_category_idx
  on public.products(store_id, category_id, active);
create index if not exists tax_rates_effective_idx
  on public.tax_rates(store_id, tax_category_id, effective_from, effective_to, active);
create index if not exists orders_store_created_idx
  on public.orders(store_id, created_at desc);
create index if not exists orders_store_status_idx
  on public.orders(store_id, status, created_at desc);
create index if not exists order_items_order_idx
  on public.order_items(store_id, order_id);
create index if not exists payments_order_idx
  on public.payments(store_id, order_id, created_at desc);
create index if not exists refunds_order_idx
  on public.refunds(store_id, order_id, created_at desc);
create index if not exists inventory_movements_product_idx
  on public.inventory_movements(store_id, product_id, created_at desc);
create index if not exists daily_reports_date_idx
  on public.daily_reports(store_id, business_date desc);
create index if not exists sync_events_device_received_idx
  on public.sync_events(store_id, device_id, received_at desc);
create index if not exists payment_webhooks_payment_idx
  on public.payment_webhook_events(store_id, payment_id, received_at desc);
create unique index if not exists one_open_shift_per_device_idx
  on public.shifts(store_id, device_id) where status = 'open';
create unique index if not exists one_successful_tender_per_order_idx
  on public.payments(store_id, order_id)
  where status in ('confirmed','partially_refunded','refunded');
create unique index if not exists provider_reference_idx
  on public.payments(provider, provider_reference)
  where provider_reference is not null;

-- RLS helper. SECURITY DEFINER avoids recursive RLS evaluation on employees;
-- keep search_path fixed and review this function when changing auth/RLS.
create or replace function public.has_store_access(p_store_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.employees e
    where e.store_id = p_store_id
      and e.auth_user_id = auth.uid()
      and e.status = 'active'
      and (p_roles is null or e.role = any(p_roles))
  );
$$;

revoke all on function public.has_store_access(uuid, text[]) from public;
grant execute on function public.has_store_access(uuid, text[]) to authenticated;

alter table public.stores enable row level security;
create policy stores_member_select on public.stores
  for select to authenticated using (public.has_store_access(id, null));

-- Ordinary authenticated clients get scoped reads only. Mutations go through Next.js
-- Route Handlers after role checks; server-only service credentials bypass RLS.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'categories','tax_categories','tax_rates','products','inventory','inventory_movements',
    'orders','order_items','order_item_taxes','payments','refunds','refund_items',
    'refund_item_taxes','shifts','daily_reports','sync_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy store_member_select on public.%I for select to authenticated using (public.has_store_access(store_id, null))',
      table_name
    );
  end loop;
end $$;

alter table public.employees enable row level security;
create policy employees_self_or_manager_select on public.employees
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or public.has_store_access(store_id, array['owner','manager']::text[])
  );

alter table public.devices enable row level security;
create policy devices_owner_manager_select on public.devices
  for select to authenticated
  using (public.has_store_access(store_id, array['owner','manager']::text[]));

alter table public.customers enable row level security;
create policy customers_manager_select on public.customers
  for select to authenticated
  using (public.has_store_access(store_id, array['owner','manager']::text[]));

-- Webhook rows are server-only; RLS is enabled and there is intentionally no
-- authenticated-user policy. The webhook route writes only after provider verification.
alter table public.payment_webhook_events enable row level security;

-- Revoke direct client mutations. Keep SELECT granted but constrained by RLS.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

-- Production notes:
-- 1) Set default privileges for future tables to prevent accidental client writes.
-- 2) Add only selected low-volume tables to the supabase_realtime publication.
-- 3) Server routes must validate Supabase user/store/role before using service_role.
-- 4) Refund totals <= captured tender and refunded item quantities <= sold quantities
--    are enforced in a DB transaction with row locks; ordinary CHECK constraints
--    cannot enforce sums across multiple refund rows.

commit;
