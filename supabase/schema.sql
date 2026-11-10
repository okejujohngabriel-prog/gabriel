create sequence if not exists public.order_number_seq start with 1049;

create table if not exists public.products (
  id text primary key,
  name text not null check (char_length(name) between 1 and 70),
  category text not null check (char_length(category) between 1 and 40),
  sku text not null unique,
  price integer not null check (price > 0),
  stock integer not null default 0 check (stock >= 0),
  icon text not null default '◈',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id text primary key,
  customer text not null check (char_length(customer) between 1 and 70),
  email text not null check (char_length(email) between 3 and 120),
  fulfillment text not null check (fulfillment in ('delivery', 'pickup')),
  delivery_address text not null default '' check (char_length(delivery_address) <= 180),
  note text not null default '' check (char_length(note) <= 240),
  amount bigint not null check (amount > 0),
  status text not null default 'Pending' check (status in ('Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled')),
  payment_status text not null default 'Unpaid' check (payment_status in ('Pending', 'Unpaid', 'Paid', 'Failed')),
  payment_method text not null default 'Pay later' check (char_length(payment_method) <= 40),
  stripe_session_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  order_id text not null references public.orders(id) on delete cascade,
  product_id text not null references public.products(id),
  product_name text not null,
  quantity integer not null check (quantity between 1 and 99),
  unit_price integer not null check (unit_price > 0),
  primary key (order_id, product_id)
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists order_items_product_id_idx on public.order_items (product_id);

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on public.products, public.orders, public.order_items from anon, authenticated;
revoke all on sequence public.order_number_seq from anon, authenticated;

insert into public.products (id, name, category, sku, price, stock, icon)
values
  ('p1', 'Everyday Tote', 'Bags & accessories', 'BAG-001', 48, 7, '◈'),
  ('p2', 'Ceramic Pour-over Set', 'Home & living', 'HOM-014', 72, 4, '◒'),
  ('p3', 'Linen Desk Pad', 'Workspace', 'DSK-008', 36, 22, '▱'),
  ('p4', 'The Daily Journal', 'Stationery', 'STA-021', 24, 3, '▤'),
  ('p5', 'Stoneware Mug', 'Home & living', 'HOM-006', 32, 16, '◡'),
  ('p6', 'Canvas Market Bag', 'Bags & accessories', 'BAG-009', 29, 0, '⌑')
on conflict (id) do nothing;

create or replace function public.create_order(
  p_customer text,
  p_email text,
  p_fulfillment text,
  p_delivery_address text,
  p_note text,
  p_items jsonb,
  p_payment_status text,
  p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item record;
  v_product public.products%rowtype;
  v_order_id text;
  v_amount bigint := 0;
  v_count integer := 0;
  v_items jsonb := '[]'::jsonb;
begin
  if p_customer is null or char_length(trim(p_customer)) not between 1 and 70
     or p_email is null or char_length(trim(p_email)) not between 3 and 120
     or p_fulfillment not in ('delivery', 'pickup')
     or (p_fulfillment = 'delivery' and char_length(trim(coalesce(p_delivery_address, ''))) not between 1 and 180)
     or char_length(coalesce(p_note, '')) > 240
     or p_payment_status not in ('Pending', 'Unpaid', 'Paid')
     or p_payment_method is null or char_length(p_payment_method) > 40
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception using errcode = 'P0001', message = 'Order details are invalid.';
  end if;

  for v_item in
    select item.product_id, sum(item.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as item(product_id text, quantity integer)
    group by item.product_id
    order by item.product_id
  loop
    v_count := v_count + 1;
    if v_item.product_id is null or v_item.quantity not between 1 and 99 then
      raise exception using errcode = 'P0001', message = 'Product quantity is invalid.';
    end if;

    select * into v_product
    from public.products
    where id = v_item.product_id and active
    for update;

    if not found or v_product.stock < v_item.quantity then
      raise exception using errcode = 'P0001', message = 'A product is unavailable in the requested quantity.';
    end if;

    update public.products
    set stock = stock - v_item.quantity
    where id = v_product.id;

    v_amount := v_amount + (v_product.price::bigint * v_item.quantity);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'product_name', v_product.name,
      'quantity', v_item.quantity,
      'unit_price', v_product.price
    ));
  end loop;

  if v_count < 1 or v_count > 20 then
    raise exception using errcode = 'P0001', message = 'Choose between 1 and 20 products.';
  end if;

  v_order_id := 'OR-' || nextval('public.order_number_seq')::text;
  insert into public.orders (
    id, customer, email, fulfillment, delivery_address, note, amount,
    payment_status, payment_method
  )
  values (
    v_order_id, trim(p_customer), lower(trim(p_email)), p_fulfillment,
    case when p_fulfillment = 'delivery' then trim(p_delivery_address) else '' end,
    trim(coalesce(p_note, '')), v_amount, p_payment_status, p_payment_method
  );

  insert into public.order_items (order_id, product_id, product_name, quantity, unit_price)
  select v_order_id, item.product_id, item.product_name, item.quantity, item.unit_price
  from jsonb_to_recordset(v_items) as item(
    product_id text, product_name text, quantity integer, unit_price integer
  );

  return jsonb_build_object(
    'id', v_order_id,
    'customer', trim(p_customer),
    'email', lower(trim(p_email)),
    'fulfillment', p_fulfillment,
    'delivery_address', case when p_fulfillment = 'delivery' then trim(p_delivery_address) else '' end,
    'note', trim(coalesce(p_note, '')),
    'amount', v_amount,
    'status', 'Pending',
    'payment_status', p_payment_status,
    'payment_method', p_payment_method,
    'created_at', now(),
    'order_items', v_items
  );
end;
$$;

create or replace function public.cancel_order(p_order_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Order not found.';
  end if;
  if v_order.status = 'Cancelled' then
    return;
  end if;
  if v_order.payment_status = 'Paid' then
    raise exception using errcode = 'P0001', message = 'Paid orders cannot be automatically cancelled.';
  end if;

  for v_item in
    select product_id, quantity from public.order_items
    where order_id = p_order_id order by product_id
  loop
    update public.products set stock = stock + v_item.quantity where id = v_item.product_id;
  end loop;

  update public.orders
  set status = 'Cancelled', payment_status = 'Failed'
  where id = p_order_id;
end;
$$;

create or replace function public.set_order_status(p_order_id text, p_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_product public.products%rowtype;
begin
  if p_status not in ('Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled') then
    raise exception using errcode = 'P0001', message = 'Order status is invalid.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Order not found.';
  end if;
  if v_order.status = p_status then
    return;
  end if;

  if v_order.payment_status = 'Paid' and p_status = 'Cancelled' then
    raise exception using errcode = 'P0001', message = 'Paid orders must be refunded before cancellation.';
  end if;

  if v_order.status = 'Cancelled' and p_status <> 'Cancelled' then
    for v_item in
      select product_id, quantity from public.order_items
      where order_id = p_order_id order by product_id
    loop
      select * into v_product from public.products where id = v_item.product_id for update;
      if not found or not v_product.active or v_product.stock < v_item.quantity then
        raise exception using errcode = 'P0001', message = 'There is not enough stock to reopen this order.';
      end if;
    end loop;
    for v_item in
      select product_id, quantity from public.order_items
      where order_id = p_order_id order by product_id
    loop
      update public.products set stock = stock - v_item.quantity where id = v_item.product_id;
    end loop;
  elsif v_order.status <> 'Cancelled' and p_status = 'Cancelled' then
    for v_item in
      select product_id, quantity from public.order_items
      where order_id = p_order_id order by product_id
    loop
      update public.products set stock = stock + v_item.quantity where id = v_item.product_id;
    end loop;
  end if;

  update public.orders set status = p_status where id = p_order_id;
end;
$$;

create or replace function public.delete_order(p_order_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Order not found.';
  end if;
  if v_order.payment_status = 'Paid' then
    raise exception using errcode = 'P0001', message = 'Paid orders cannot be deleted.';
  end if;

  if v_order.status <> 'Cancelled' then
    for v_item in
      select product_id, quantity from public.order_items
      where order_id = p_order_id order by product_id
    loop
      update public.products set stock = stock + v_item.quantity where id = v_item.product_id;
    end loop;
  end if;
  delete from public.orders where id = p_order_id;
end;
$$;

revoke all on function public.create_order(text, text, text, text, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.cancel_order(text) from public, anon, authenticated;
revoke all on function public.set_order_status(text, text) from public, anon, authenticated;
revoke all on function public.delete_order(text) from public, anon, authenticated;
grant execute on function public.create_order(text, text, text, text, text, jsonb, text, text) to service_role;
grant execute on function public.cancel_order(text) to service_role;
grant execute on function public.set_order_status(text, text) to service_role;
grant execute on function public.delete_order(text) to service_role;
