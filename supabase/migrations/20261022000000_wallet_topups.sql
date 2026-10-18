-- Top-up RPC is service-role-only. The HTTP worker fetches the invoice from
-- Moyasar before issuing `topup_credit`; no customer-supplied success is trusted.
create table public.wallet_topups (
 id uuid primary key,
 customer_id uuid not null references public.profiles(id),
 amount_halalas int not null check(amount_halalas between 100 and 1000000),
 invoice_id uuid unique,
 checkout_url text,
 credited_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.wallet_topups enable row level security;
revoke all on public.wallet_topups from anon,authenticated;
grant all on public.wallet_topups to service_role;
alter function public.benefits(text,uuid,jsonb) rename to benefits_v1;
create function public.benefits(p_action text,p_actor uuid,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.wallet_topups; k uuid; amount int;
begin
 if p_action not like 'topup_%' then return public.benefits_v1(p_action,p_actor,p_data); end if;
 k:=(p_data->>'id')::uuid;
 if p_action='topup_lookup' then
  select * into t from public.wallet_topups where id=k;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
  return to_jsonb(t);
 end if;
 if not exists(select 1 from public.profiles where id=p_actor and disabled_at is null) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_action='topup_create' then
  amount:=(p_data->>'amount')::int;
  insert into public.wallet_topups(id,customer_id,amount_halalas) values(k,p_actor,amount) on conflict(id) do nothing;
 end if;
 select * into t from public.wallet_topups where id=k for update;
 if not found or t.customer_id<>p_actor then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
 if p_action='topup_create' and t.amount_halalas<>(p_data->>'amount')::int then return jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');end if;
 if p_action='topup_attach' then
  if t.invoice_id is not null and t.invoice_id<>(p_data->>'invoiceId')::uuid then return jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');end if;
  update public.wallet_topups set invoice_id=(p_data->>'invoiceId')::uuid,checkout_url=p_data->>'url' where id=k returning * into t;
 elsif p_action='topup_credit' and t.credited_at is null then
  if t.invoice_id is null or t.invoice_id<>(p_data->>'invoiceId')::uuid or t.amount_halalas<>(p_data->>'amount')::int then return jsonb_build_object('ok',false,'code','INVALID_REQUEST');end if;
  insert into public.benefit_accounts(customer_id) values(p_actor) on conflict do nothing;
  update public.benefit_accounts set balance_halalas=balance_halalas+t.amount_halalas where customer_id=p_actor;
  insert into public.benefit_movements(customer_id,amount_halalas,reason,idempotency_key) values(p_actor,t.amount_halalas,'شحن الرصيد عبر ميسر',t.id);
  update public.wallet_topups set credited_at=now() where id=k returning * into t;
 elsif p_action not in ('topup_create','topup_status','topup_attach','topup_credit') then return jsonb_build_object('ok',false,'code','INVALID_REQUEST');end if;
 return to_jsonb(t);
exception when invalid_text_representation or check_violation or not_null_violation or unique_violation then return jsonb_build_object('ok',false,'code','INVALID_REQUEST');
end $$;
revoke all on function public.benefits(text,uuid,jsonb),public.benefits_v1(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.benefits(text,uuid,jsonb) to service_role;
