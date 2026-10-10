-- Privacy consent audit is deliberately minimized: no receipt address or phone is stored here.
-- Apply this reviewed migration before enabling managed payment/contact flows.
begin;

create table if not exists public.privacy_consent_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  order_id uuid not null,
  employee_id uuid not null,
  purpose_code text not null check (purpose_code in ('digital_payment_contact','receipt_email')),
  policy_version text not null,
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (store_id, order_id) references public.orders(store_id, id) on delete restrict,
  foreign key (store_id, employee_id) references public.employees(store_id, id) on delete restrict,
  unique (store_id, order_id, purpose_code, policy_version)
);

create index if not exists privacy_consent_events_order_idx
  on public.privacy_consent_events(store_id, order_id, consented_at desc);

alter table public.privacy_consent_events enable row level security;
revoke all on public.privacy_consent_events from anon, authenticated;

commit;
