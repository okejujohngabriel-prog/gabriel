CREATE SEQUENCE IF NOT EXISTS public.order_number_seq START WITH 1049;

CREATE TABLE IF NOT EXISTS public.products (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 70),
  category text NOT NULL CHECK (char_length(category) BETWEEN 1 AND 40),
  sku text NOT NULL UNIQUE,
  price integer NOT NULL CHECK (price > 0),
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  icon text NOT NULL DEFAULT '◈',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.orders (
  id text PRIMARY KEY,
  customer text NOT NULL CHECK (char_length(customer) BETWEEN 1 AND 70),
  email text,
  phone text NOT NULL DEFAULT '',
  fulfillment text NOT NULL CHECK (fulfillment IN ('delivery', 'pickup')),
  delivery_address text NOT NULL DEFAULT '' CHECK (char_length(delivery_address) <= 180),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 240),
  amount bigint NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled')),
  payment_status text NOT NULL DEFAULT 'Unpaid'
    CHECK (payment_status IN ('Pending', 'Unpaid', 'Paid', 'Failed')),
  payment_method text NOT NULL DEFAULT 'Pay later' CHECK (char_length(payment_method) <= 40),
  stripe_session_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
ALTER TABLE public.orders ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_phone_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_phone_check
  CHECK (
    phone = '' OR (
      char_length(phone) BETWEEN 7 AND 24
      AND phone ~ '^\+?[0-9 ().-]+$'
      AND char_length(regexp_replace(phone, '[^0-9]', '', 'g')) BETWEEN 7 AND 15
    )
  );

CREATE TABLE IF NOT EXISTS public.order_items (
  order_id text NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES public.products(id),
  product_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  unit_price integer NOT NULL CHECK (unit_price > 0),
  PRIMARY KEY (order_id, product_id)
);

CREATE INDEX IF NOT EXISTS orders_created_at_idx ON public.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS order_items_product_id_idx ON public.order_items (product_id);

INSERT INTO public.products (id, name, category, sku, price, stock, icon)
VALUES
  ('p1', 'Everyday Tote', 'Bags & accessories', 'BAG-001', 48, 7, '◈'),
  ('p2', 'Ceramic Pour-over Set', 'Home & living', 'HOM-014', 72, 4, '◒'),
  ('p3', 'Linen Desk Pad', 'Workspace', 'DSK-008', 36, 22, '▱'),
  ('p4', 'The Daily Journal', 'Stationery', 'STA-021', 24, 3, '▤'),
  ('p5', 'Stoneware Mug', 'Home & living', 'HOM-006', 32, 16, '◡'),
  ('p6', 'Canvas Market Bag', 'Bags & accessories', 'BAG-009', 29, 0, '⌑')
ON CONFLICT (id) DO NOTHING;
