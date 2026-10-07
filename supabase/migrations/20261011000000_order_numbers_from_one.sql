-- Order numbers start at #1 instead of #1001. The counter is only rewound
-- while there are no orders, so existing numbers can never repeat.
alter table public.orders alter column order_number set start with 1;

do $$
begin
  if not exists (select 1 from public.orders) then
    alter table public.orders alter column order_number restart with 1;
  end if;
end
$$;
