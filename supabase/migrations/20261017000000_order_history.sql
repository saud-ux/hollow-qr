-- Order history for the admin: every order (open, completed or cancelled)
-- created in [p_from, p_to), narrowed to a state and searched by order number,
-- customer name, phone or member ID. Returns one page plus the count per state
-- (for the filter chips) and the sales of the completed orders in the filter.
--
-- p_status: 'all' | 'active' (not finished yet) | 'ended' (completed or
-- cancelled) | 'completed' | 'cancelled'. A null p_from / p_to is open-ended.
create function public.order_history(
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
                   'payment_method', p.payment_method,
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
                   'created_at', p.created_at,
                   'items', (
                     select coalesce(jsonb_agg(jsonb_build_object(
                              'menu_item_id', i.menu_item_id,
                              'name_ar', i.name_ar,
                              'category', i.category,
                              'unit_price_halalas', i.unit_price_halalas,
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

revoke execute on function public.order_history(timestamptz, timestamptz, text, text, int, int) from public, anon, authenticated;
grant execute on function public.order_history(timestamptz, timestamptz, text, text, int, int) to service_role;
