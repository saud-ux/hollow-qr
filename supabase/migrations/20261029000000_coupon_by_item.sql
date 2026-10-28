-- The coupon preview also says how much of the coupon landed on each menu
-- item, so checkout can show each line's price struck through with its new
-- price. Only a new key is added to the result: the function is otherwise the
-- same as in 20261021000000_customer_benefits.sql, character for character,
-- so every existing amount (and so every order total) stays exactly as it was.
-- `coupon_by_item` maps a menu item id to the halalas the coupon took off its
-- units in this order; its values always add up to `coupon_discount`.
-- Privileges are kept: `create or replace` leaves the earlier revoke in place.

create or replace function public.benefit_quote(p_customer uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 s public.shop_settings; a public.benefit_accounts; cp public.coupons;
 line record; units jsonb:='[]'; u jsonb; v int; base int; listprice int;
 subtotal int:=0; gift_discount int:=0; reward_discount int:=0; coupon_discount int:=0;
 gift_remaining int:=coalesce((p_data->>'giftCups')::int,0); gifts int:=gift_remaining;
 reward_remaining int:=case when coalesce((p_data->>'useReward')::boolean,false) then 1 else 0 end;
 paid_drinks int:=0; fee int:=0; total int; wallet int:=0; eligible_list int:=0; existing_promo int:=0;
 cp_budget int:=0; raw_budget int:=0; remaining_budget int:=0; remaining_list int:=0; extra int; n int:=0; drink_free boolean;
 v_code text:=lower(btrim(coalesce(p_data->>'couponCode','')));
 coupon_by_item jsonb:='{}'; item_key text;
begin
 select * into s from public.shop_settings where id=1;
 select * into a from public.benefit_accounts where customer_id=p_customer;
 if gifts<0 or gifts>40 or gifts>coalesce(a.gift_cups,0) then return jsonb_build_object('ok',false,'code','NOT_ENOUGH_GIFTS'); end if;
 if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 30 then return jsonb_build_object('ok',false,'code','EMPTY_ORDER'); end if;
 -- Expand units, sort by list price: gifts always cover the most expensive eligible coffee first.
 for line in select m.*, (e->>'quantity')::int qty, e->>'optionId' chosen_option
  from jsonb_array_elements(p_data->'items') e join public.menu_items m on m.id=(e->>'menuItemId')::uuid
 loop
  if line.qty is null or line.qty not between 1 and 20 or not line.is_available or line.is_archived then return jsonb_build_object('ok',false,'code','ITEM_UNAVAILABLE'); end if;
  n:=n+line.qty;
  v:=coalesce(public.discount_percent_for(s,line.id,now()),0);
  base:=round(line.price_halalas*(100-v)/100.0)::int;
  for i in 1..line.qty loop
   units:=units||jsonb_build_array(jsonb_build_object('id',line.id,'list',line.price_halalas,'price',base,'drink',line.category='drink','gift',exists(select 1 from public.gift_coffee_items where item_id=line.id)));
  end loop;
 end loop;
 if n=0 or n>40 or (select count(*) from jsonb_array_elements(p_data->'items')) <>
  (select count(*) from jsonb_array_elements(p_data->'items') e join public.menu_items m on m.id=(e->>'menuItemId')::uuid)
 then return jsonb_build_object('ok',false,'code','ITEM_UNAVAILABLE'); end if;
 if v_code<>'' then
  select * into cp from public.coupons where coupons.code=v_code;
  if not found or not cp.active or cp.starts_at>now() or cp.ends_at<=now() then return jsonb_build_object('ok',false,'code','COUPON_INVALID'); end if;
  if cp.per_customer_limit is not null and (select count(*) from public.coupon_uses where coupon_id=cp.id and customer_id=p_customer)>=cp.per_customer_limit then return jsonb_build_object('ok',false,'code','COUPON_LIMIT'); end if;
 end if;
 -- First allocate gifted cups, then the existing loyalty reward to a remaining drink.
 units:=(select jsonb_agg(x order by (x->>'list')::int desc,x->>'id') from jsonb_array_elements(units) x);
 for u in select x from jsonb_array_elements(units) x loop
  base:=(u->>'price')::int;
  subtotal:=subtotal+base;
  if gift_remaining>0 and (u->>'gift')::boolean then gift_discount:=gift_discount+base;gift_remaining:=gift_remaining-1; end if;
 end loop;
 if gift_remaining<>0 then return jsonb_build_object('ok',false,'code','GIFT_NEEDS_COFFEE'); end if;
 gift_remaining:=gifts;
 -- Determine coupon base only from payable items; delivery is never discounted.
 for u in select x from jsonb_array_elements(units) x loop
  drink_free:=false; base:=(u->>'price')::int;
  if gift_remaining>0 and (u->>'gift')::boolean then gift_remaining:=gift_remaining-1; drink_free:=true;
  elsif reward_remaining>0 and (u->>'drink')::boolean then reward_remaining:=0;reward_discount:=base;drink_free:=true; end if;
  if not drink_free and cp.id is not null and (cardinality(cp.item_ids)=0 or (u->>'id')::uuid=any(cp.item_ids)) then
   eligible_list:=eligible_list+(u->>'list')::int;
   existing_promo:=existing_promo+(u->>'list')::int-base;
  end if;
 end loop;
 if reward_remaining>0 then return jsonb_build_object('ok',false,'code','REWARD_NEEDS_DRINK'); end if;
 if cp.id is not null then
  if subtotal-gift_discount-reward_discount<cp.minimum_halalas then return jsonb_build_object('ok',false,'code','COUPON_MINIMUM'); end if;
  if eligible_list=0 then return jsonb_build_object('ok',false,'code','COUPON_NO_ITEMS'); end if;
  raw_budget:=case when cp.kind='fixed' then least(cp.value,eligible_list) else round(eligible_list*cp.value/100.0)::int end;
  cp_budget:=least(raw_budget,coalesce(cp.maximum_halalas,raw_budget));
 end if;
 remaining_budget:=cp_budget;remaining_list:=eligible_list;
 gift_remaining:=gifts;reward_remaining:=case when coalesce((p_data->>'useReward')::boolean,false) then 1 else 0 end;
 for u in select x from jsonb_array_elements(units) x loop
  base:=(u->>'price')::int;listprice:=(u->>'list')::int;drink_free:=false;
  if gift_remaining>0 and (u->>'gift')::boolean then gift_remaining:=gift_remaining-1;drink_free:=true;
  elsif reward_remaining>0 and (u->>'drink')::boolean then reward_remaining:=0;drink_free:=true; end if;
  extra:=0;
  if not drink_free and cp.id is not null and (cardinality(cp.item_ids)=0 or (u->>'id')::uuid=any(cp.item_ids)) then
   -- Proportional coupon share; compare it with the menu discount on each unit.
   v:=floor(remaining_budget::numeric*listprice/remaining_list)::int;
   remaining_budget:=remaining_budget-v;remaining_list:=remaining_list-listprice;
   extra:=greatest(0,v-(listprice-base));
   coupon_discount:=coupon_discount+extra;
   if extra>0 then item_key:=u->>'id'; coupon_by_item:=jsonb_set(coupon_by_item,array[item_key],to_jsonb(coalesce((coupon_by_item->>item_key)::int,0)+extra)); end if;
  end if;
  if (u->>'drink')::boolean and not drink_free and base-extra>0 then paid_drinks:=paid_drinks+1; end if;
 end loop;
 if p_data->>'fulfillment'='delivery' then fee:=s.delivery_fee_halalas; end if;
 total:=greatest(0,subtotal+fee-gift_discount-reward_discount-coupon_discount);
 if coalesce((p_data->>'useBalance')::boolean,false) then wallet:=least(total,coalesce(a.balance_halalas,0)); end if;
 return jsonb_build_object('ok',true,'subtotal',subtotal,'fee',fee,'gift_discount',gift_discount,'reward_discount',reward_discount,'coupon_discount',coupon_discount,'total',total,'wallet_used',wallet,'due',total-wallet,'gifts',gifts,'paid_drinks',paid_drinks,'coupon_id',case when coupon_discount>0 then cp.id end,'coupon_by_item',coupon_by_item);
end $$;
