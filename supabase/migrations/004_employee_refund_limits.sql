-- Refund limits are per transaction, expressed in the store currency's minor units.
-- 0 means no refunds; NULL means no configured cap and is reserved for owner profiles.
begin;

alter table public.employees
  add column if not exists refund_limit_minor bigint default 0;

alter table public.employees
  drop constraint if exists employees_refund_limit_minor_check;
alter table public.employees
  add constraint employees_refund_limit_minor_check
  check ((refund_limit_minor is null and role = 'owner') or (refund_limit_minor is not null and refund_limit_minor >= 0));

commit;
