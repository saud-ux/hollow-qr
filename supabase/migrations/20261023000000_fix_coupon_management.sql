-- Repair the existing function without replacing unrelated benefit logic or grants.
-- wallet_topups wraps this function as benefits_v1.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.benefits_v1(text,uuid,jsonb)'::regprocedure);
  definition := replace(definition,
    'jsonb_agg(c order by c.code),''[]'') from public.coupons c',
    'jsonb_agg(coupon_row order by coupon_row.code),''[]'') from public.coupons coupon_row');
  if position('jsonb_agg(coupon_row order by coupon_row.code)' in definition) = 0 then
    raise exception 'Coupon listing repair could not be applied';
  end if;
  -- A duplicate code should produce an actionable response and keep existing data.
  if position('COUPON_EXISTS' in definition) = 0 then
    definition := replace(definition,
      'elsif p_action=''save_coupon'' then',
      'elsif p_action=''save_coupon'' then begin');
    definition := replace(definition,
      'elsif p_action in (''adjust'',''spend'') then',
      'exception when unique_violation then return jsonb_build_object(''ok'',false,''code'',''COUPON_EXISTS''); end;
 elsif p_action in (''adjust'',''spend'') then');
  end if;
  execute definition;
end $$;
