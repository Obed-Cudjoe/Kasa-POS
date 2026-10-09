begin;

-- Append-only signed movement ledger; stock projection updates are additive. A stale physical
-- count is rejected for manager review, while sale/return/receiving movements never overwrite
-- another cashier's delta. Negative stock is retained as a visible concurrency conflict.
create or replace function public.apply_pos_movement(
  p_store_id uuid,
  p_device_id uuid,
  p_employee_id uuid,
  p_movement jsonb
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product_id uuid := (p_movement->>'productId')::uuid;
  v_movement_id uuid := (p_movement->>'id')::uuid;
  v_type text := p_movement->>'movementType';
  v_delta numeric(14,3) := (p_movement->>'quantityDelta')::numeric;
  v_base bigint := nullif(p_movement->>'baseVersion','')::bigint;
  v_current_version bigint;
  v_new_quantity numeric(14,3);
  v_rows integer;
  v_occurred_at timestamptz := coalesce(nullif(p_movement->>'createdAt','')::timestamptz, now());
begin
  if v_delta = 0 then raise exception 'Inventory movement cannot be zero.'; end if;
  select row_version into v_current_version
    from public.inventory
   where store_id = p_store_id and product_id = v_product_id
   for update;
  v_current_version := coalesce(v_current_version, 0);

  if v_type = 'count_adjustment' and v_current_version is distinct from v_base then
    return false;
  end if;

  insert into public.inventory_movements(
    id, store_id, product_id, device_id, employee_id, movement_type, quantity_delta,
    base_inventory_version, client_event_id, order_id, refund_id, reason, occurred_at_device
  ) values (
    v_movement_id, p_store_id, v_product_id, p_device_id, p_employee_id, v_type, v_delta,
    v_base, v_movement_id, nullif(p_movement->>'orderId','')::uuid,
    nullif(p_movement->>'refundId','')::uuid, p_movement->>'reason', v_occurred_at
  ) on conflict (store_id, device_id, client_event_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return true; end if;

  insert into public.inventory(store_id, product_id, quantity_on_hand, row_version, updated_at)
  values (p_store_id, v_product_id, v_delta, 1, now())
  on conflict (store_id, product_id) do update
    set quantity_on_hand = public.inventory.quantity_on_hand + excluded.quantity_on_hand,
        row_version = public.inventory.row_version + 1,
        updated_at = now()
  returning quantity_on_hand into v_new_quantity;

  if v_type = 'count_adjustment' then return true; end if;
  return v_new_quantity >= 0;
end;
$$;

revoke all on function public.apply_pos_movement(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_pos_movement(uuid, uuid, uuid, jsonb) to service_role;

create or replace function public.ingest_pos_event(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_store_id uuid := (p_event->>'storeId')::uuid;
  v_device_id uuid := (p_event->>'deviceId')::uuid;
  v_employee_id uuid := (p_event->>'employeeId')::uuid;
  v_event_id uuid := (p_event->>'eventId')::uuid;
  v_event_type text := p_event->>'eventType';
  v_payload jsonb := p_event->'payload';
  v_existing public.sync_events%rowtype;
  v_order jsonb;
  v_payment jsonb;
  v_item jsonb;
  v_tax jsonb;
  v_movement jsonb;
  v_refund jsonb;
  v_product jsonb;
  v_category jsonb;
  v_employee jsonb;
  v_shift jsonb;
  v_order_id uuid;
  v_item_id uuid;
  v_category_id uuid;
  v_refund_item_id uuid;
  v_refund_total bigint;
  v_result text := 'accepted';
  v_summary jsonb := '{}'::jsonb;
  v_method text;
  v_order_status text;
  v_payment_status text;
  v_rows integer;
  v_rate_id uuid;
begin
  if v_store_id is null or v_device_id is null or v_employee_id is null or v_event_id is null then
    raise exception 'Sync event is missing a required UUID.';
  end if;

  select * into v_existing from public.sync_events
   where store_id = v_store_id and device_id = v_device_id and client_event_id = v_event_id;
  if found then
    return jsonb_build_object('eventId', v_event_id, 'status', v_existing.result_status,
      'summary', v_existing.response_summary, 'duplicate', true);
  end if;

  if not exists (select 1 from public.employees where store_id = v_store_id and id = v_employee_id and status = 'active') then
    raise exception 'Sync employee is not active in this store.';
  end if;
  if not exists (select 1 from public.devices where store_id = v_store_id and id = v_device_id and status = 'active') then
    insert into public.devices(store_id, id, device_name, platform, status, enrolled_by, last_seen_at)
    values (v_store_id, v_device_id, 'POS tablet', 'web-pwa', 'active', v_employee_id, now())
    on conflict (store_id, id) do update set last_seen_at = now();
  else
    update public.devices set last_seen_at = now() where store_id = v_store_id and id = v_device_id;
  end if;

  if v_event_type = 'order' then
    v_order := v_payload->'order';
    v_payment := v_payload->'payment';
    if v_order is null or v_payment is null then raise exception 'Order event must contain an order and payment.'; end if;
    v_order_id := (v_order->>'id')::uuid;
    v_method := v_payment->>'method';
    v_order_status := v_order->>'status';
    v_payment_status := v_payment->>'status';
    if v_method not in ('cash','card','momo') then raise exception 'Unsupported tender method.'; end if;
    if v_method = 'cash' and v_payment_status <> 'confirmed' then raise exception 'Cash sales must be recorded as confirmed.'; end if;
    if v_method in ('card','momo') and v_payment_status <> 'pending' then
      raise exception 'A digital payment can only be marked paid by a verified provider route.';
    end if;
    if v_method in ('card','momo') and v_order_status <> 'pending_payment' then
      raise exception 'Unverified digital payments must remain pending.';
    end if;

    insert into public.orders(
      id, store_id, device_id, employee_id, shift_id, client_order_id, order_number, status,
      currency_code, subtotal_amount, tax_amount, total_amount, tax_snapshot, local_created_at,
      created_at, updated_at, paid_at
    ) values (
      v_order_id, v_store_id, v_device_id, v_employee_id,
      nullif(v_order->>'shiftId','')::uuid, (v_order->>'clientOrderId')::uuid,
      v_order->>'orderNumber', v_order_status, v_order->>'currencyCode',
      (v_order->>'subtotalMinor')::bigint, (v_order->>'taxMinor')::bigint,
      (v_order->>'totalMinor')::bigint,
      coalesce(v_order->'items','[]'::jsonb),
      nullif(v_order->>'localCreatedAt','')::timestamptz,
      coalesce(nullif(v_order->>'createdAt','')::timestamptz, now()), now(),
      case when v_method = 'cash' then now() else null end
    ) on conflict (store_id, device_id, client_order_id) do nothing;

    if not exists (select 1 from public.order_items where store_id = v_store_id and order_id = v_order_id) then
      for v_item in select value from jsonb_array_elements(coalesce(v_order->'items','[]'::jsonb)) loop
        v_item_id := gen_random_uuid();
        insert into public.order_items(
          id, store_id, order_id, product_id, product_name_snapshot, sku_snapshot,
          tax_category_name_snapshot, quantity, currency_code, price_mode, unit_price,
          line_subtotal, tax_rate, tax_amount, line_total, tax_snapshot
        ) values (
          v_item_id, v_store_id, v_order_id, (v_item->>'productId')::uuid,
          v_item->>'name', v_item->>'sku', v_item->>'taxCategoryName',
          (v_item->>'quantity')::numeric, v_order->>'currencyCode', v_item->>'priceMode',
          (v_item->>'unitPriceMinor')::bigint, (v_item->>'taxableBaseMinor')::bigint,
          (v_item->>'taxRatePercent')::numeric, (v_item->>'taxMinor')::bigint,
          (v_item->>'grossMinor')::bigint, coalesce(v_item->'taxBreakdown','[]'::jsonb)
        );
        for v_tax in select value from jsonb_array_elements(coalesce(v_item->'taxBreakdown','[]'::jsonb)) loop
          insert into public.order_item_taxes(
            store_id, order_item_id, component_code, component_name_snapshot, rate_percent,
            taxable_base_amount, tax_amount, calculation_method, calculation_order
          ) values (
            v_store_id, v_item_id, v_tax->>'code', v_tax->>'name',
            (v_tax->>'ratePercent')::numeric, (v_tax->>'baseMinor')::bigint,
            (v_tax->>'taxMinor')::bigint, 'same_base', 1
          ) on conflict (store_id, order_item_id, component_code) do nothing;
        end loop;
      end loop;
    end if;

    insert into public.payments(
      id, store_id, order_id, device_id, method, provider, provider_network,
      provider_reference, provider_transaction_id, idempotency_key, status, amount,
      currency_code, created_at, confirmed_at
    ) values (
      (v_payment->>'id')::uuid, v_store_id, v_order_id, v_device_id, v_method,
      case when v_method = 'cash' then null else coalesce(v_payment->>'provider','paystack') end,
      v_payment->>'providerNetwork', v_payment->>'providerReference',
      v_payment->>'providerTransactionId', (v_payment->>'idempotencyKey')::uuid,
      v_payment_status, (v_payment->>'amountMinor')::bigint, v_payment->>'currencyCode',
      coalesce(nullif(v_payment->>'createdAt','')::timestamptz, now()),
      case when v_method = 'cash' then now() else null end
    ) on conflict (store_id, idempotency_key) do nothing;

    for v_movement in select value from jsonb_array_elements(coalesce(v_payload->'inventoryMovements','[]'::jsonb)) loop
      if not public.apply_pos_movement(v_store_id, v_device_id, v_employee_id, v_movement) then
        v_result := 'conflict';
        v_summary := v_summary || jsonb_build_object('inventoryReview', true, 'productId', v_movement->>'productId');
      end if;
    end loop;
    v_summary := v_summary || jsonb_build_object('orderId', v_order_id, 'orderNumber', v_order->>'orderNumber');

  elsif v_event_type = 'inventory_movement' then
    v_movement := coalesce(v_payload->'movement', v_payload);
    if not public.apply_pos_movement(v_store_id, v_device_id, v_employee_id, v_movement) then
      v_result := 'conflict';
      v_summary := jsonb_build_object('reason', 'Stock changed since the physical count was started. Review current stock and recount.', 'productId', v_movement->>'productId');
    else
      v_summary := jsonb_build_object('movementId', v_movement->>'id');
    end if;

  elsif v_event_type = 'refund' then
    v_refund := v_payload->'refund';
    if v_refund is null then raise exception 'Refund event is missing its refund.'; end if;
    v_order_id := (v_refund->>'orderId')::uuid;
    perform 1 from public.orders where store_id = v_store_id and id = v_order_id for update;
    if not found then raise exception 'Original order is not present in cloud.'; end if;
    select coalesce(sum(amount),0) into v_refund_total from public.refunds
      where store_id = v_store_id and order_id = v_order_id and status <> 'failed';
    if v_refund_total + (v_refund->>'amountMinor')::bigint > (select total_amount from public.orders where store_id=v_store_id and id=v_order_id) then
      raise exception 'Refund would exceed the remaining captured sale amount.';
    end if;
    insert into public.refunds(
      id, store_id, order_id, payment_id, requested_by, approved_by, device_id,
      idempotency_key, status, reason, amount, tax_amount, currency_code,
      provider_refund_id, offline_created_at, created_at
    ) values (
      (v_refund->>'id')::uuid, v_store_id, v_order_id, (v_refund->>'paymentId')::uuid,
      v_employee_id, v_employee_id, v_device_id, (v_event->>'eventId')::uuid,
      case when (v_refund->>'method') = 'cash' then 'processed' else 'pending' end,
      coalesce(v_refund->>'reason','Customer return'), (v_refund->>'amountMinor')::bigint,
      (v_refund->>'taxMinor')::bigint, (v_payload->'order'->>'currencyCode'),
      v_refund->>'providerRefundId', nullif(v_refund->>'createdAt','')::timestamptz,
      coalesce(nullif(v_refund->>'createdAt','')::timestamptz, now())
    ) on conflict (store_id, idempotency_key) do nothing;

    for v_item in select value from jsonb_array_elements(coalesce(v_refund->'lines','[]'::jsonb)) loop
      select oi.id into v_item_id from public.order_items oi
        where oi.store_id = v_store_id and oi.order_id = v_order_id and oi.product_id = (v_item->>'productId')::uuid
        order by oi.created_at limit 1;
      if v_item_id is null then raise exception 'Returned product is not on the original order.'; end if;
      insert into public.refund_items(store_id, refund_id, order_item_id, quantity, restock, item_amount, tax_amount)
      values (
        v_store_id, (v_refund->>'id')::uuid, v_item_id, (v_item->>'quantity')::numeric,
        coalesce((v_item->>'restock')::boolean,true), (v_item->>'itemMinor')::bigint,
        (v_item->>'taxMinor')::bigint
      ) on conflict (store_id, refund_id, order_item_id) do nothing;
    end loop;
    for v_movement in select value from jsonb_array_elements(coalesce(v_payload->'inventoryMovements','[]'::jsonb)) loop
      if not public.apply_pos_movement(v_store_id, v_device_id, v_employee_id, v_movement) then
        v_result := 'conflict';
        v_summary := v_summary || jsonb_build_object('inventoryReview', true, 'productId', v_movement->>'productId');
      end if;
    end loop;
    select coalesce(sum(amount),0) into v_refund_total from public.refunds
      where store_id = v_store_id and order_id = v_order_id and status = 'processed';
    update public.orders set status = case
      when v_refund_total >= total_amount then 'refunded'
      when v_refund_total > 0 or exists (
        select 1 from public.refunds r where r.store_id = v_store_id and r.order_id = v_order_id
          and r.status in ('requested','pending','processing','needs_attention')
      ) then 'partially_refunded'
      else 'paid' end,
      updated_at = now() where store_id = v_store_id and id = v_order_id;
    v_summary := v_summary || jsonb_build_object('refundId', v_refund->>'id', 'orderId', v_order_id);

  elsif v_event_type = 'shift' then
    v_shift := coalesce(v_payload->'shift', v_payload);
    insert into public.shifts(
      id, store_id, device_id, employee_id, status, currency_code, opening_float,
      expected_cash, counted_cash, variance_amount, variance_reason, opened_at_device,
      opened_at, closed_at_device, closed_at, closed_by
    ) values (
      (v_shift->>'id')::uuid, v_store_id, v_device_id, v_employee_id,
      case when (v_shift->>'status')='closed' then 'closed' else 'open' end,
      'GHS', coalesce((v_shift->>'openingFloatMinor')::bigint,0),
      nullif(v_shift->>'expectedCashMinor','')::bigint,
      nullif(v_shift->>'countedCashMinor','')::bigint,
      nullif(v_shift->>'varianceMinor','')::bigint, v_shift->>'varianceReason',
      nullif(v_shift->>'openedAt','')::timestamptz,
      coalesce(nullif(v_shift->>'openedAt','')::timestamptz,now()),
      nullif(v_shift->>'closedAt','')::timestamptz,
      nullif(v_shift->>'closedAt','')::timestamptz,
      case when (v_shift->>'status')='closed' then v_employee_id else null end
    ) on conflict (store_id, id) do update set
      status=excluded.status, expected_cash=excluded.expected_cash, counted_cash=excluded.counted_cash,
      variance_amount=excluded.variance_amount, variance_reason=excluded.variance_reason,
      closed_at_device=excluded.closed_at_device, closed_at=excluded.closed_at,
      closed_by=excluded.closed_by;
    v_summary := jsonb_build_object('shiftId', v_shift->>'id');

  elsif v_event_type = 'product' then
    v_product := coalesce(v_payload->'product', v_payload);
    insert into public.categories(store_id, id, name, active)
    values (v_store_id, (v_product->>'categoryId')::uuid, coalesce(v_product->>'categoryName','General'), true)
    on conflict (store_id, name) do update set active=true
    returning id into v_category_id;
    if v_category_id is null then v_category_id := (v_product->>'categoryId')::uuid; end if;
    insert into public.products(
      id, store_id, category_id, tax_category_id, name, sku, unit_name,
      price_minor, currency_code, price_mode, tax_rate, active, row_version, updated_at
    ) values (
      (v_product->>'id')::uuid, v_store_id, v_category_id, (v_product->>'taxCategoryId')::uuid,
      v_product->>'name', nullif(v_product->>'sku',''), coalesce(v_product->>'unitName','each'),
      (v_product->>'priceMinor')::bigint, coalesce(v_product->>'currencyCode','GHS'),
      coalesce(v_product->>'priceMode','inclusive'), nullif(v_product->>'taxRateOverride','')::numeric,
      coalesce((v_product->>'active')::boolean,true), coalesce((v_product->>'rowVersion')::bigint,1), now()
    ) on conflict (store_id, id) do update set
      category_id=excluded.category_id, tax_category_id=excluded.tax_category_id,
      name=excluded.name, sku=excluded.sku, unit_name=excluded.unit_name,
      price_minor=excluded.price_minor, currency_code=excluded.currency_code,
      price_mode=excluded.price_mode, tax_rate=excluded.tax_rate, active=excluded.active,
      row_version=greatest(public.products.row_version + 1, excluded.row_version), updated_at=now();
    v_summary := jsonb_build_object('productId', v_product->>'id');

  elsif v_event_type = 'tax' then
    v_category := coalesce(v_payload->'taxCategory', v_payload);
    insert into public.tax_categories(
      id, store_id, code, name, treatment, jurisdiction_code, default_price_mode,
      active, effective_from
    ) values (
      (v_category->>'id')::uuid, v_store_id, v_category->>'code', v_category->>'name',
      v_category->>'treatment', coalesce(v_category->>'jurisdictionCode','GH'),
      coalesce(v_category->>'defaultPriceMode','inclusive'),
      coalesce((v_category->>'active')::boolean,true),
      coalesce((v_category->>'effectiveFrom')::date,current_date)
    ) on conflict (store_id, id) do update set
      code=excluded.code, name=excluded.name, treatment=excluded.treatment,
      default_price_mode=excluded.default_price_mode, active=excluded.active,
      effective_from=excluded.effective_from, updated_at=now();
    update public.tax_rates set active=false
      where store_id=v_store_id and tax_category_id=(v_category->>'id')::uuid and active=true;
    for v_tax in select value from jsonb_array_elements(coalesce(v_category->'components','[]'::jsonb)) loop
      if coalesce(v_tax->>'id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_rate_id := (v_tax->>'id')::uuid;
      else
        v_rate_id := gen_random_uuid();
      end if;
      insert into public.tax_rates(
        id, store_id, tax_category_id, component_code, component_name,
        rate_percent, calculation_method, calculation_order, effective_from, active
      ) values (
        v_rate_id, v_store_id, (v_category->>'id')::uuid, v_tax->>'code', v_tax->>'name',
        (v_tax->>'ratePercent')::numeric, coalesce(v_tax->>'method','same_base'),
        coalesce((v_tax->>'order')::smallint,1), coalesce((v_category->>'effectiveFrom')::date,current_date), true
      ) on conflict (store_id, tax_category_id, component_code, effective_from) do update set
        component_name=excluded.component_name, rate_percent=excluded.rate_percent,
        calculation_method=excluded.calculation_method, calculation_order=excluded.calculation_order,
        active=true;
    end loop;
    v_summary := jsonb_build_object('taxCategoryId', v_category->>'id');

  elsif v_event_type = 'employee' then
    v_employee := coalesce(v_payload->'employee', v_payload);
    insert into public.employees(id, store_id, display_name, role, status)
    values (
      (v_employee->>'id')::uuid, v_store_id, v_employee->>'displayName',
      v_employee->>'role', coalesce(v_employee->>'status','active')
    ) on conflict (store_id, id) do update set
      display_name=excluded.display_name, role=excluded.role, status=excluded.status, updated_at=now();
    v_summary := jsonb_build_object('employeeId', v_employee->>'id', 'note', 'Supabase Auth account invitation is a separate owner action.');

  else
    raise exception 'Unsupported sync event type: %', v_event_type;
  end if;

  insert into public.sync_events(
    store_id, device_id, employee_id, client_event_id, event_type,
    payload_hash, result_status, result_reference, response_summary
  ) values (
    v_store_id, v_device_id, v_employee_id, v_event_id, v_event_type,
    md5(p_event::text), v_result, coalesce(nullif(v_summary->>'orderId','')::uuid, nullif(v_summary->>'productId','')::uuid), v_summary
  ) on conflict (store_id, device_id, client_event_id) do nothing;
  return jsonb_build_object('eventId', v_event_id, 'status', v_result, 'summary', v_summary, 'duplicate', false);
end;
$$;

revoke all on function public.ingest_pos_event(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_pos_event(jsonb) to service_role;

-- Called only after Paystack server-side verification or a valid signed webhook. It locks the
-- payment, checks amount/currency/reference, and records stock movements exactly once.
create or replace function public.confirm_paystack_payment(
  p_reference text,
  p_amount bigint,
  p_currency text,
  p_transaction_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_item record;
  v_new_quantity numeric(14,3);
begin
  select * into v_payment from public.payments
   where provider='paystack' and provider_reference=p_reference
   for update;
  if not found then raise exception 'Payment reference is not linked to a POS order.'; end if;
  if v_payment.amount <> p_amount or v_payment.currency_code <> p_currency then
    raise exception 'Verified provider amount or currency does not match the POS order.';
  end if;
  if v_payment.status in ('confirmed','partially_refunded','refunded') then
    return jsonb_build_object('status','already_confirmed','orderId',v_payment.order_id);
  end if;
  select * into v_order from public.orders where store_id=v_payment.store_id and id=v_payment.order_id for update;
  if not found then raise exception 'Linked POS order is missing.'; end if;
  update public.payments set status='confirmed', provider_transaction_id=p_transaction_id,
    confirmed_at=coalesce(confirmed_at,now()), updated_at=now()
   where store_id=v_payment.store_id and id=v_payment.id;
  update public.orders set status='paid', paid_at=coalesce(paid_at,now()), updated_at=now()
   where store_id=v_payment.store_id and id=v_payment.order_id;

  for v_item in select product_id, quantity from public.order_items
    where store_id=v_payment.store_id and order_id=v_payment.order_id loop
    insert into public.inventory_movements(
      store_id, product_id, device_id, employee_id, movement_type, quantity_delta,
      base_inventory_version, client_event_id, order_id, occurred_at_device
    ) values (
      v_payment.store_id, v_item.product_id, v_payment.device_id,
      (select employee_id from public.orders where id=v_payment.order_id),
      'sale', -v_item.quantity, null, gen_random_uuid(), v_payment.order_id, now()
    );
    insert into public.inventory(store_id, product_id, quantity_on_hand, row_version, updated_at)
    values (v_payment.store_id, v_item.product_id, -v_item.quantity, 1, now())
    on conflict (store_id, product_id) do update set
      quantity_on_hand=public.inventory.quantity_on_hand - v_item.quantity,
      row_version=public.inventory.row_version + 1, updated_at=now()
    returning quantity_on_hand into v_new_quantity;
  end loop;
  return jsonb_build_object('status','confirmed','orderId',v_payment.order_id,'paymentId',v_payment.id);
end;
$$;

revoke all on function public.confirm_paystack_payment(text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.confirm_paystack_payment(text, bigint, text, text) to service_role;

commit;
