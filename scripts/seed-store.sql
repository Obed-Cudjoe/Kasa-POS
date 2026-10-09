-- OPTIONAL first-run example for a new Supabase project.
-- Before running: create the owner in Supabase Auth, then replace BOTH UUID placeholders below.
-- This seeds a small, explicitly UNVERIFIED GHS demonstration catalogue. Review all tax values with
-- an accountant/GRA before live sales; this script does not certify E-VAT/CIS compliance.
-- Run only after applying supabase/migrations/001_pos_schema.sql.

do $$
declare
  v_store_id uuid := 'REPLACE-WITH-NEW-STORE-UUID';
  v_owner_auth_user_id uuid := 'REPLACE-WITH-SUPABASE-AUTH-USER-UUID';
  v_standard_tax_id uuid := gen_random_uuid();
  v_zero_tax_id uuid := gen_random_uuid();
  v_grocery_id uuid := gen_random_uuid();
  v_drinks_id uuid := gen_random_uuid();
  v_household_id uuid := gen_random_uuid();
  v_snacks_id uuid := gen_random_uuid();
  v_fresh_id uuid := gen_random_uuid();
  v_vat_id uuid := gen_random_uuid();
  v_nhil_id uuid := gen_random_uuid();
  v_getfund_id uuid := gen_random_uuid();
  v_product_id uuid;
begin
  insert into public.stores(id, name, country_code, base_currency, timezone, tax_registration_status, e_vat_status)
  values (v_store_id, 'Accra Retail Store', 'GH', 'GHS', 'Africa/Accra', 'unverified', 'not_configured');

  insert into public.employees(store_id, auth_user_id, display_name, role, status)
  values (v_store_id, v_owner_auth_user_id, 'Store Owner', 'owner', 'active');

  insert into public.categories(store_id, id, name) values
    (v_store_id, v_grocery_id, 'Groceries'),
    (v_store_id, v_drinks_id, 'Drinks'),
    (v_store_id, v_household_id, 'Household'),
    (v_store_id, v_snacks_id, 'Snacks'),
    (v_store_id, v_fresh_id, 'Fresh food');

  insert into public.tax_categories(store_id, id, code, name, treatment, jurisdiction_code, default_price_mode, effective_from)
  values
    (v_store_id, v_standard_tax_id, 'STANDARD-GH-DEMO', 'Standard rated · Ghana demo · unverified', 'standard_rated', 'GH', 'inclusive', date '2026-01-01'),
    (v_store_id, v_zero_tax_id, 'ZERO-DEMO', 'Zero-rated · demo · verify classification', 'zero_rated', 'GH', 'inclusive', date '2026-01-01');

  insert into public.tax_rates(id, store_id, tax_category_id, component_code, component_name, rate_percent, calculation_method, calculation_order, effective_from)
  values
    (v_vat_id, v_store_id, v_standard_tax_id, 'VAT', 'VAT · demo', 15.000000, 'same_base', 1, date '2026-01-01'),
    (v_nhil_id, v_store_id, v_standard_tax_id, 'NHIL', 'NHIL · demo', 2.500000, 'same_base', 2, date '2026-01-01'),
    (v_getfund_id, v_store_id, v_standard_tax_id, 'GETFUND', 'GETFund · demo', 2.500000, 'same_base', 3, date '2026-01-01');

  insert into public.products(store_id, category_id, tax_category_id, name, sku, price_minor, currency_code, price_mode, unit_name)
  values (v_store_id, v_grocery_id, v_standard_tax_id, 'Rice · 1 kg', 'P-001', 2500, 'GHS', 'inclusive', 'each') returning id into v_product_id;
  insert into public.inventory(store_id, product_id, quantity_on_hand) values (v_store_id, v_product_id, 18);

  insert into public.products(store_id, category_id, tax_category_id, name, sku, price_minor, currency_code, price_mode, unit_name)
  values (v_store_id, v_grocery_id, v_standard_tax_id, 'Cooking oil · 1 L', 'P-002', 3200, 'GHS', 'inclusive', 'each') returning id into v_product_id;
  insert into public.inventory(store_id, product_id, quantity_on_hand) values (v_store_id, v_product_id, 9);

  insert into public.products(store_id, category_id, tax_category_id, name, sku, price_minor, currency_code, price_mode, unit_name)
  values (v_store_id, v_drinks_id, v_standard_tax_id, 'Mineral water · 500 ml', 'P-004', 500, 'GHS', 'inclusive', 'each') returning id into v_product_id;
  insert into public.inventory(store_id, product_id, quantity_on_hand) values (v_store_id, v_product_id, 36);

  insert into public.products(store_id, category_id, tax_category_id, name, sku, price_minor, currency_code, price_mode, unit_name)
  values (v_store_id, v_household_id, v_standard_tax_id, 'Soap bar', 'P-005', 700, 'GHS', 'inclusive', 'each') returning id into v_product_id;
  insert into public.inventory(store_id, product_id, quantity_on_hand) values (v_store_id, v_product_id, 15);

  insert into public.products(store_id, category_id, tax_category_id, name, sku, price_minor, currency_code, price_mode, unit_name)
  values (v_store_id, v_fresh_id, v_zero_tax_id, 'Eggs · half crate', 'P-016', 4200, 'GHS', 'inclusive', 'each') returning id into v_product_id;
  insert into public.inventory(store_id, product_id, quantity_on_hand) values (v_store_id, v_product_id, 4);

  insert into public.products(store_id, category_id, tax_category_id, name, sku, price_minor, currency_code, price_mode, unit_name)
  values (v_store_id, v_snacks_id, v_standard_tax_id, 'Biscuits · family pack', 'P-014', 900, 'GHS', 'inclusive', 'each') returning id into v_product_id;
  insert into public.inventory(store_id, product_id, quantity_on_hand) values (v_store_id, v_product_id, 23);
end $$;

-- After successful setup, set POS_STORE_ID to the exact v_store_id used above and set
-- NEXT_PUBLIC_DEMO_MODE=false. The owner can then sign in using their Supabase Auth credentials.
