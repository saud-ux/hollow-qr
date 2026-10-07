-- Sales numbers for the admin dashboard: completed orders in a period and the
-- period before it, sales per local day, orders per weekday and hour, and the
-- best sellers. Times are grouped on the shop's wall clock (p_tz).
create function public.sales_report(
  p_from timestamptz,
  p_to timestamptz,
  p_prev_from timestamptz,
  p_prev_to timestamptz,
  p_tz text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with cur as (
    select o.id, o.total_halalas, o.created_at at time zone p_tz as local_at
      from public.orders o
     where o.status = 'completed' and o.created_at >= p_from and o.created_at < p_to
  )
  select jsonb_build_object(
    'orders', (select count(*) from cur),
    'revenue_halalas', (select coalesce(sum(cur.total_halalas), 0) from cur),
    'cancelled', (
      select count(*) from public.orders o
       where o.status = 'cancelled' and o.created_at >= p_from and o.created_at < p_to
    ),
    'previous', (
      select jsonb_build_object('orders', count(*), 'revenue_halalas', coalesce(sum(o.total_halalas), 0))
        from public.orders o
       where o.status = 'completed' and o.created_at >= p_prev_from and o.created_at < p_prev_to
    ),
    'days', (
      select coalesce(
               jsonb_agg(
                 jsonb_build_object('date', to_char(d.day, 'YYYY-MM-DD'), 'orders', coalesce(x.orders, 0), 'revenue_halalas', coalesce(x.revenue, 0))
                 order by d.day
               ),
               '[]'::jsonb
             )
        from generate_series(
               (p_from at time zone p_tz)::date,
               ((p_to at time zone p_tz) - interval '1 microsecond')::date,
               interval '1 day'
             ) as d (day)
        left join (
          select cur.local_at::date as day, count(*) as orders, sum(cur.total_halalas) as revenue
            from cur
           group by 1
        ) x on x.day = d.day::date
    ),
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object('weekday', h.dow, 'hour', h.hr, 'orders', h.n) order by h.dow, h.hr), '[]'::jsonb)
        from (
          select extract(dow from cur.local_at)::int as dow, extract(hour from cur.local_at)::int as hr, count(*) as n
            from cur
           group by 1, 2
        ) h
    ),
    'top_items', (
      select coalesce(
               jsonb_agg(
                 jsonb_build_object('name_ar', t.name_ar, 'option_name_ar', t.option_name_ar, 'quantity', t.qty, 'revenue_halalas', t.revenue)
                 order by t.qty desc, t.revenue desc, t.name_ar
               ),
               '[]'::jsonb
             )
        from (
          select i.name_ar, i.option_name_ar, sum(i.quantity) as qty, sum(i.quantity * i.unit_price_halalas) as revenue
            from public.order_items i
            join cur on cur.id = i.order_id
           group by i.name_ar, i.option_name_ar
           order by qty desc, revenue desc, i.name_ar
           limit 8
        ) t
    )
  );
$$;

revoke execute on function public.sales_report(timestamptz, timestamptz, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.sales_report(timestamptz, timestamptz, timestamptz, timestamptz, text) to service_role;
