-- Staging feature: coupons, monetary credit and separately gifted coffee cups.
-- All money is integer halalas. No client-provided prices or payment-success flags.
create table public.benefit_accounts (
 customer_id uuid primary key references public.profiles(id),
 balance_halalas int not null default 0 check(balance_halalas >= 0),
 gift_cups int not null default 0 check(gift_cups >= 0)
);
create table public.benefit_movements (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.profiles(id),
 actor_id uuid references public.profiles(id),
 amount_halalas int not null default 0,
 cups int not null default 0,
 reason text not null check(length(reason) between 1 and 300),
 idempotency_key uuid not null unique,
 order_id uuid references public.orders(id),
 created_at timestamptz not null default now()
);
create index benefit_movements_customer on public.benefit_movements(customer_id,created_at desc);
create table public.coupons (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check(length(code) between 1 and 40 and code = lower(btrim(code))),
 kind text not null check(kind in ('percent','fixed')),
 value int not null check(value > 0),
 item_ids uuid[] not null default '{}' check(cardinality(item_ids) <= 200),
 minimum_halalas int not null default 0 check(minimum_halalas >= 0),
 maximum_halalas int check(maximum_halalas > 0),
 per_customer_limit int check(per_customer_limit > 0),
 starts_at timestamptz,
 ends_at timestamptz,
 active boolean not null default true,
 check(kind <> 'percent' or value <= 100),
 check(ends_at is null or starts_at is null or ends_at > starts_at)
);
create table public.coupon_uses (
 order_id uuid primary key references public.orders(id),
 coupon_id uuid not null references public.coupons(id),
 customer_id uuid not null references public.profiles(id)
);
create index coupon_uses_customer on public.coupon_uses(coupon_id,customer_id);
create table public.gift_coffee_items (item_id uuid primary key references public.menu_items(id) on delete cascade);
-- Explicit supported products; no match-all "drink" flag (matcha/hibiscus excluded).
insert into public.gift_coffee_items(item_id)
select id from public.menu_items where category='drink' and name_ar in
 ('قهوة اليوم حارة','قهوة اليوم باردة','قهوة مقطرة','قهوة مقطرة باردة');
alter table public.orders
 add column benefit_gift_cups int not null default 0,
 add column benefit_wallet_halalas int not null default 0,
 add column benefit_coupon_halalas int not null default 0,
 add column benefit_gift_halalas int not null default 0,
 add column benefit_paid_drinks int;

alter table public.benefit_accounts enable row level security;
alter table public.benefit_movements enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_uses enable row level security;
alter table public.gift_coffee_items enable row level security;
revoke all on public.benefit_accounts,public.benefit_movements,public.coupons,public.coupon_uses,public.gift_coffee_items from anon,authenticated;
grant all on public.benefit_accounts,public.benefit_movements,public.coupons,public.coupon_uses,public.gift_coffee_items to service_role;

-- Pricing preview is also called inside the locked checkout transaction.
create function public.benefit_quote(p_customer uuid,p_data jsonb) returns jsonb
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
  end if;
  if (u->>'drink')::boolean and not drink_free and base-extra>0 then paid_drinks:=paid_drinks+1; end if;
 end loop;
 if p_data->>'fulfillment'='delivery' then fee:=s.delivery_fee_halalas; end if;
 total:=greatest(0,subtotal+fee-gift_discount-reward_discount-coupon_discount);
 if coalesce((p_data->>'useBalance')::boolean,false) then wallet:=least(total,coalesce(a.balance_halalas,0)); end if;
 return jsonb_build_object('ok',true,'subtotal',subtotal,'fee',fee,'gift_discount',gift_discount,'reward_discount',reward_discount,'coupon_discount',coupon_discount,'total',total,'wallet_used',wallet,'due',total-wallet,'gifts',gifts,'paid_drinks',paid_drinks,'coupon_id',case when coupon_discount>0 then cp.id end);
end $$;

create function public.benefits(p_action text,p_actor uuid,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; target uuid; a public.benefit_accounts; prev public.benefit_movements;
 amount int; cups int; k uuid; why text; q jsonb; res jsonb; o public.orders; cid uuid; items jsonb; c public.coupons;
begin
 select * into actor from public.profiles where id=p_actor and disabled_at is null;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 if p_action in ('coupons','save_coupon','adjust','save_gift_items') and actor.role<>'admin' then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 if p_action='spend' and actor.role not in ('staff','admin') then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 target:=p_actor;
 if p_data->>'accountId' is not null then
  if actor.role not in ('staff','admin') then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  select user_id into target from public.loyalty_accounts where id=(p_data->>'accountId')::uuid and membership_status='active';
 end if;
 if not exists(select 1 from public.profiles where id=target and disabled_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
 if p_action in ('account','quote','place','adjust','spend') then
  insert into public.benefit_accounts(customer_id) values(target) on conflict do nothing;
  select * into a from public.benefit_accounts where customer_id=target for update;
 end if;
 if p_action='account' then
  return to_jsonb(a)||jsonb_build_object('gift_item_ids',(select coalesce(jsonb_agg(item_id),'[]') from public.gift_coffee_items),'movements',(select coalesce(jsonb_agg(x),'[]') from (select bm.id,bm.amount_halalas,bm.cups,bm.reason,bm.created_at,(select p.display_name from public.profiles p where p.id=bm.actor_id) as actor_name from public.benefit_movements bm where bm.customer_id=target order by bm.created_at desc limit 100) x));
 elsif p_action='gift_items' then return jsonb_build_object('items',(select coalesce(jsonb_agg(item_id),'[]') from public.gift_coffee_items));
 elsif p_action='save_gift_items' then
  delete from public.gift_coffee_items;
  insert into public.gift_coffee_items select m.id from public.menu_items m where m.category='drink' and m.id in(select value::uuid from jsonb_array_elements_text(p_data->'items'));
  return jsonb_build_object('ok',true);
 elsif p_action='coupons' then return jsonb_build_object('items',(select coalesce(jsonb_agg(c order by c.code),'[]') from public.coupons c));
 elsif p_action='save_coupon' then
  cid:=coalesce((p_data->>'id')::uuid,gen_random_uuid());
  insert into public.coupons(id,code,kind,value,item_ids,minimum_halalas,maximum_halalas,per_customer_limit,starts_at,ends_at,active)
  values(cid,lower(btrim(p_data->>'code')),p_data->>'kind',(p_data->>'value')::int,
    array(select value::uuid from jsonb_array_elements_text(coalesce(p_data->'item_ids','[]'))),coalesce((p_data->>'minimum_halalas')::int,0),(p_data->>'maximum_halalas')::int,(p_data->>'per_customer_limit')::int,(p_data->>'starts_at')::timestamptz,(p_data->>'ends_at')::timestamptz,coalesce((p_data->>'active')::boolean,true))
  on conflict(id) do update set code=excluded.code,kind=excluded.kind,value=excluded.value,item_ids=excluded.item_ids,minimum_halalas=excluded.minimum_halalas,maximum_halalas=excluded.maximum_halalas,per_customer_limit=excluded.per_customer_limit,starts_at=excluded.starts_at,ends_at=excluded.ends_at,active=excluded.active;
  return jsonb_build_object('ok',true,'id',cid);
 elsif p_action in ('adjust','spend') then
  k:=(p_data->>'idempotencyKey')::uuid;why:=btrim(p_data->>'reason');
  amount:=coalesce((p_data->>'amountHalalas')::int,0);cups:=coalesce((p_data->>'cups')::int,0);
  if p_action='spend' then
   if amount<0 or cups<0 then return jsonb_build_object('ok',false,'code','INVALID_QUANTITY'); end if;
   -- Cashier selects eligible coffee products when spending gifted cups.
   if cups>0 and (not exists(select 1 from public.gift_coffee_items where item_id=(p_data->>'menuItemId')::uuid)) then return jsonb_build_object('ok',false,'code','GIFT_NEEDS_COFFEE'); end if;
   amount:=-amount;cups:=-cups;
  end if;
  if k is null or why is null or length(why) not between 1 and 300 or abs(amount)>100000000 or abs(cups)>10000 or (amount=0 and cups=0) then return jsonb_build_object('ok',false,'code','INVALID_QUANTITY'); end if;
  select * into prev from public.benefit_movements where idempotency_key=k;
  if found then
   if prev.customer_id<>target or prev.actor_id<>p_actor or prev.amount_halalas<>amount or prev.cups<>cups or prev.reason<>why then return jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); end if;
   return jsonb_build_object('ok',true,'replayed',true);
  end if;
  if a.balance_halalas+amount<0 or a.gift_cups+cups<0 then return jsonb_build_object('ok',false,'code','INSUFFICIENT_BALANCE'); end if;
  insert into public.benefit_movements(customer_id,actor_id,amount_halalas,cups,reason,idempotency_key) values(target,p_actor,amount,cups,why,k);
  update public.benefit_accounts set balance_halalas=balance_halalas+amount,gift_cups=gift_cups+cups where customer_id=target;
  return jsonb_build_object('ok',true);
 elsif p_action in ('quote','place') then
  -- Serialize against edits and redemption limits; same-customer wallet lock prevents double spend.
  if coalesce(p_data->>'couponCode','')<>'' then perform 1 from public.coupons where code=lower(btrim(p_data->>'couponCode')) for update; end if;
  if p_action='place' then
   k:=(p_data->>'idempotencyKey')::uuid;
   if k is null then return jsonb_build_object('ok',false,'code','INVALID_REQUEST'); end if;
   select * into o from public.orders where idempotency_key=k;
   if found then
    if o.customer_id<>target then return jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');end if;
    return jsonb_build_object('ok',true,'order_id',o.id,'replayed',true);
   end if;
  end if;
  q:=public.benefit_quote(target,p_data);
  if not (q->>'ok')::boolean or p_action='quote' then return q; end if;
  -- Original order routine retains stock, opening hours, options, reward and minimum checks.
  items:=(select jsonb_agg(jsonb_build_object('menu_item_id',e->>'menuItemId','quantity',e->'quantity','option_id',e->>'optionId','note',e->>'note')) from jsonb_array_elements(p_data->'items') e);
  res:=public.place_order(target,items,(p_data->>'fulfillment')::public.fulfillment_type,p_data->>'phone',p_data->>'carDescription',p_data->>'deliveryAddress',(p_data->>'deliveryLat')::double precision,(p_data->>'deliveryLng')::double precision,p_data->>'note',coalesce((p_data->>'useReward')::boolean,false),k,coalesce(p_data->>'timeZone','Asia/Riyadh'));
  if not (res->>'ok')::boolean then return res; end if;
  cid:=(res->>'order_id')::uuid;
  update public.orders set discount_halalas=(q->>'gift_discount')::int+(q->>'reward_discount')::int+(q->>'coupon_discount')::int,total_halalas=(q->>'total')::int,
    benefit_gift_cups=(q->>'gifts')::int,benefit_wallet_halalas=(q->>'wallet_used')::int,benefit_coupon_halalas=(q->>'coupon_discount')::int,benefit_gift_halalas=(q->>'gift_discount')::int,benefit_paid_drinks=(q->>'paid_drinks')::int where id=cid;
  if (q->>'coupon_id') is not null then insert into public.coupon_uses(order_id,coupon_id,customer_id) values(cid,(q->>'coupon_id')::uuid,target); end if;
  amount:=(q->>'wallet_used')::int;cups:=(q->>'gifts')::int;
  if amount>0 or cups>0 then
   update public.benefit_accounts set balance_halalas=balance_halalas-amount,gift_cups=gift_cups-cups where customer_id=target;
   insert into public.benefit_movements(customer_id,actor_id,amount_halalas,cups,reason,idempotency_key,order_id) values(target,p_actor,-amount,-cups,'استخدام في طلب',k,cid);
  end if;
  return res;
 end if;
 return jsonb_build_object('ok',false,'code','INVALID_REQUEST');
exception when invalid_text_representation or check_violation or not_null_violation or numeric_value_out_of_range or unique_violation or foreign_key_violation then
 return jsonb_build_object('ok',false,'code','INVALID_REQUEST');
end $$;

-- A cancellation in either existing path refunds wallet/gifts once and releases coupon usage.
create function public.restore_order_benefits() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='cancelled' and old.status<>'cancelled' then
  if old.benefit_wallet_halalas>0 or old.benefit_gift_cups>0 then
   update public.benefit_accounts set balance_halalas=balance_halalas+old.benefit_wallet_halalas,gift_cups=gift_cups+old.benefit_gift_cups where customer_id=old.customer_id;
   insert into public.benefit_movements(customer_id,amount_halalas,cups,reason,idempotency_key,order_id)
    values(old.customer_id,old.benefit_wallet_halalas,old.benefit_gift_cups,'استرجاع طلب ملغي',gen_random_uuid(),old.id);
  end if;
  delete from public.coupon_uses where order_id=old.id;
 end if;
 return new;
end $$;
create trigger restore_order_benefits after update of status on public.orders for each row execute function public.restore_order_benefits();
revoke all on function public.benefits(text,uuid,jsonb),public.benefit_quote(uuid,jsonb),public.restore_order_benefits() from public,anon,authenticated;
grant execute on function public.benefits(text,uuid,jsonb) to service_role;

-- Gifted/free units never earn loyalty. Legacy orders retain the original behavior.
create or replace function public.set_order_status(
  p_actor_id uuid,
  p_order_id uuid,
  p_status public.order_status,
  p_cancel_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_stamps constant int := 5;
  actor public.profiles;
  o public.orders;
  acct public.loyalty_accounts;
  allowed boolean;
  drinks int;
  eligible int;
  room int;
  res jsonb;
  redeem_code text := null;
  cups_added int := 0;
  changed boolean := false;
  v_pass_serial uuid := null;
  now_ts timestamptz := now();
begin
  select * into actor from public.profiles where id = p_actor_id and disabled_at is null;
  if not found or actor.role not in ('staff', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  allowed := case
    when p_status = 'cancelled' then o.status not in ('completed', 'cancelled')
    when p_status = 'preparing' then o.status = 'new'
    when p_status = 'ready' then o.status = 'preparing'
    when p_status = 'out_for_delivery' then o.status = 'ready' and o.fulfillment = 'delivery'
    when p_status = 'completed' then
      (o.status = 'ready' and o.fulfillment <> 'delivery') or o.status = 'out_for_delivery'
    else false
  end;
  if not allowed then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION', 'current', o.status);
  end if;

  if p_status = 'completed' then
    select * into acct from public.loyalty_accounts where user_id = o.customer_id;
    if found and acct.membership_status = 'active' then
      v_pass_serial := acct.pass_serial;

      if o.use_reward then
        res := public.apply_loyalty_action(p_actor_id, acct.id, 'REDEEM_REWARD', null, null,
                                           o.loyalty_redeem_key, true, 0, 'app_order');
        if (res ->> 'ok')::boolean then
          redeem_code := 'REDEEMED';
          changed := changed or not coalesce((res ->> 'replayed')::boolean, false);
        else
          -- The reward was used in store meanwhile: staff are told on screen.
          redeem_code := coalesce(res ->> 'code', 'FAILED');
        end if;
      end if;

      select coalesce(sum(quantity), 0) into drinks
        from public.order_items where order_id = o.id and category = 'drink';
      eligible := coalesce(o.benefit_paid_drinks, drinks - case when o.use_reward then 1 else 0 end);

      select * into acct from public.loyalty_accounts where id = acct.id;
      room := case when acct.reward_available then 0 else max_stamps - acct.stamp_count end;
      if eligible > 0 and room > 0 then
        res := public.apply_loyalty_action(p_actor_id, acct.id, 'ADD_CUPS', least(eligible, room), null,
                                           o.loyalty_add_key, true, 0, 'app_order');
        if (res ->> 'ok')::boolean then
          cups_added := least(eligible, room);
          changed := changed or not coalesce((res ->> 'replayed')::boolean, false);
        end if;
      end if;

      o.loyalty_result := jsonb_build_object(
        'redeem', redeem_code,
        'cups_added', cups_added,
        'cups_not_added', greatest(eligible - cups_added, 0)
      );
    else
      o.loyalty_result := jsonb_build_object('redeem', null, 'cups_added', 0, 'cups_not_added', 0, 'skipped', true);
    end if;
  end if;

  update public.orders
     set status = p_status,
         accepted_at = case when p_status = 'preparing' then now_ts else accepted_at end,
         ready_at = case when p_status = 'ready' then now_ts else ready_at end,
         out_for_delivery_at = case when p_status = 'out_for_delivery' then now_ts else out_for_delivery_at end,
         completed_at = case when p_status = 'completed' then now_ts else completed_at end,
         completed_by = case when p_status = 'completed' then p_actor_id else completed_by end,
         cancelled_at = case when p_status = 'cancelled' then now_ts else cancelled_at end,
         cancelled_by = case when p_status = 'cancelled' then 'staff' else cancelled_by end,
         cancel_reason = case when p_status = 'cancelled' then nullif(btrim(left(p_cancel_reason, 200)), '') else cancel_reason end,
         loyalty_result = case when p_status = 'completed' then o.loyalty_result else loyalty_result end
   where id = o.id;

  return jsonb_build_object(
    'ok', true,
    'order_id', o.id,
    'status', p_status,
    'loyalty_changed', changed,
    'pass_serial', case when changed then v_pass_serial end
  );
end;
$$;

create or replace function public.list_orders(
  p_customer_id uuid default null,
  p_order_id uuid default null,
  p_scope text default 'all',
  p_recent_minutes int default 120,
  p_limit int default 50
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_json order by created_at desc), '[]'::jsonb)
    from (
      select o.created_at,
             jsonb_build_object(
               'id', o.id,
               'order_number', o.order_number,
               'customer_id', o.customer_id,
               'customer_name', o.customer_name,
               'customer_phone', o.customer_phone,
               'member_id', a.member_id,
               'fulfillment', o.fulfillment,
               'car_description', o.car_description,
               'delivery_address', o.delivery_address,
               'delivery_lat', o.delivery_lat,
               'delivery_lng', o.delivery_lng,
               'note', o.note,
               'subtotal_halalas', o.subtotal_halalas,
               'delivery_fee_halalas', o.delivery_fee_halalas,
               'discount_halalas', o.discount_halalas,
               'total_halalas', o.total_halalas,
               'payment_method', o.payment_method, 'wallet_halalas',o.benefit_wallet_halalas,'gift_cups',o.benefit_gift_cups,'gift_halalas',o.benefit_gift_halalas,'coupon_halalas',o.benefit_coupon_halalas,
               'use_reward', o.use_reward,
               'status', o.status,
               'cancel_reason', o.cancel_reason,
               'cancelled_by', o.cancelled_by,
               'customer_arrived_at', o.customer_arrived_at,
               'accepted_at', o.accepted_at,
               'ready_at', o.ready_at,
               'out_for_delivery_at', o.out_for_delivery_at,
               'completed_at', o.completed_at,
               'cancelled_at', o.cancelled_at,
               'loyalty_result', o.loyalty_result,
               'rating', o.rating,
               'rating_comment', o.rating_comment,
               'rated_at', o.rated_at,
               'promo_percent', o.promo_percent,
               'promo_savings_halalas', o.promo_savings_halalas,
               'created_at', o.created_at,
               'items', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'menu_item_id', i.menu_item_id,
                          'name_ar', i.name_ar,
                          'category', i.category,
                          'unit_price_halalas', i.unit_price_halalas,
                          'list_price_halalas', i.list_price_halalas,
                          'quantity', i.quantity,
                          'note', i.note,
                          'option_id', i.option_id,
                          'option_name_ar', i.option_name_ar
                        ) order by i.position), '[]'::jsonb)
                   from public.order_items i where i.order_id = o.id
               )
             ) as row_json
        from public.orders o
        left join public.loyalty_accounts a on a.user_id = o.customer_id
       where (p_customer_id is null or o.customer_id = p_customer_id)
         and (p_order_id is null or o.id = p_order_id)
         and (p_scope <> 'active'
              or o.status not in ('completed', 'cancelled')
              or coalesce(o.completed_at, o.cancelled_at) > now() - make_interval(mins => greatest(coalesce(p_recent_minutes, 120), 0)))
       order by o.created_at desc
       limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) rows;
$$;

create or replace function public.order_history(
  p_from timestamptz,
  p_to timestamptz,
  p_status text,
  p_search text,
  p_limit int,
  p_offset int
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select nullif(lower(btrim(coalesce(p_search, ''))), '') as term,
           case when btrim(coalesce(p_search, '')) ~ '^#?[0-9]{1,12}$'
                then ltrim(btrim(p_search), '#')::bigint end as num
  ),
  base as (
    select o.*, a.id as account_id, a.member_id
      from public.orders o
      left join public.loyalty_accounts a on a.user_id = o.customer_id
      cross join q
     where (p_from is null or o.created_at >= p_from)
       and (p_to is null or o.created_at < p_to)
       and (q.term is null
            or o.order_number = q.num
            or position(q.term in lower(o.customer_name)) > 0
            or position(q.term in o.customer_phone) > 0
            or position(q.term in lower(coalesce(a.member_id, ''))) > 0)
  ),
  picked as (
    select *
      from base b
     where case coalesce(p_status, 'all')
             when 'active' then b.status not in ('completed', 'cancelled')
             when 'ended' then b.status in ('completed', 'cancelled')
             when 'completed' then b.status = 'completed'
             when 'cancelled' then b.status = 'cancelled'
             else true
           end
  )
  select jsonb_build_object(
    'counts', (
      select jsonb_build_object(
               'all', count(*),
               'active', count(*) filter (where b.status not in ('completed', 'cancelled')),
               'completed', count(*) filter (where b.status = 'completed'),
               'cancelled', count(*) filter (where b.status = 'cancelled')
             )
        from base b
    ),
    'total', (select count(*) from picked),
    'revenue_halalas', (select coalesce(sum(p.total_halalas), 0) from picked p where p.status = 'completed'),
    'items', (
      select coalesce(jsonb_agg(page.row_json order by page.created_at desc, page.order_number desc), '[]'::jsonb)
        from (
          select p.created_at,
                 p.order_number,
                 jsonb_build_object(
                   'id', p.id,
                   'order_number', p.order_number,
                   'customer_id', p.customer_id,
                   'account_id', p.account_id,
                   'customer_name', p.customer_name,
                   'customer_phone', p.customer_phone,
                   'member_id', p.member_id,
                   'fulfillment', p.fulfillment,
                   'car_description', p.car_description,
                   'delivery_address', p.delivery_address,
                   'delivery_lat', p.delivery_lat,
                   'delivery_lng', p.delivery_lng,
                   'note', p.note,
                   'subtotal_halalas', p.subtotal_halalas,
                   'delivery_fee_halalas', p.delivery_fee_halalas,
                   'discount_halalas', p.discount_halalas,
                   'total_halalas', p.total_halalas,
                   'payment_method', p.payment_method, 'wallet_halalas',p.benefit_wallet_halalas,'gift_cups',p.benefit_gift_cups,'gift_halalas',p.benefit_gift_halalas,'coupon_halalas',p.benefit_coupon_halalas,
                   'use_reward', p.use_reward,
                   'status', p.status,
                   'cancel_reason', p.cancel_reason,
                   'cancelled_by', p.cancelled_by,
                   'customer_arrived_at', p.customer_arrived_at,
                   'accepted_at', p.accepted_at,
                   'ready_at', p.ready_at,
                   'out_for_delivery_at', p.out_for_delivery_at,
                   'completed_at', p.completed_at,
                   'completed_by_name', cb.display_name,
                   'cancelled_at', p.cancelled_at,
                   'loyalty_result', p.loyalty_result,
                   'rating', p.rating,
                   'rating_comment', p.rating_comment,
                   'rated_at', p.rated_at,
                   'promo_percent', p.promo_percent,
                   'promo_savings_halalas', p.promo_savings_halalas,
                   'created_at', p.created_at,
                   'items', (
                     select coalesce(jsonb_agg(jsonb_build_object(
                              'menu_item_id', i.menu_item_id,
                              'name_ar', i.name_ar,
                              'category', i.category,
                              'unit_price_halalas', i.unit_price_halalas,
                              'list_price_halalas', i.list_price_halalas,
                              'quantity', i.quantity,
                              'note', i.note,
                              'option_id', i.option_id,
                              'option_name_ar', i.option_name_ar
                            ) order by i.position), '[]'::jsonb)
                       from public.order_items i where i.order_id = p.id
                   )
                 ) as row_json
            from picked p
            left join public.profiles cb on cb.id = p.completed_by
           order by p.created_at desc, p.order_number desc
           limit least(greatest(coalesce(p_limit, 30), 1), 200)
          offset greatest(coalesce(p_offset, 0), 0)
        ) page
    )
  );
$$;
