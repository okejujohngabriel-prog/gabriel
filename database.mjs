import pg from "pg";

const { Pool } = pg;
const connectionName = process.env.INSTANCE_CONNECTION_NAME;
const databaseUrl = process.env.DATABASE_URL;
const databaseUser = process.env.DB_USER;
const databasePassword = process.env.DB_PASSWORD;
const databaseName = process.env.DB_NAME;

export const databaseConfigured = Boolean(
  databaseUrl || (connectionName && databaseUser && databasePassword && databaseName)
);

const pool = databaseConfigured
  ? new Pool({
      ...(databaseUrl
        ? { connectionString: databaseUrl }
        : {
            host: `/cloudsql/${connectionName}`,
            user: databaseUser,
            password: databasePassword,
            database: databaseName
          }),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    })
  : null;

function databaseFailure(error) {
  console.error("PostgreSQL request failed:", error.code || error.message);
  return Object.assign(new Error("The database could not complete the request."), { status: 502 });
}

async function query(target, statement, values = []) {
  try {
    return await target.query(statement, values);
  } catch (error) {
    if (error.status) throw error;
    throw databaseFailure(error);
  }
}

async function transaction(operation) {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("PostgreSQL rollback failed:", rollbackError.code || rollbackError.message);
      }
    }
    if (error.status) throw error;
    throw databaseFailure(error);
  } finally {
    client?.release();
  }
}

function orderItemsQuery() {
  return `SELECT product_id, product_name, quantity, unit_price
          FROM public.order_items WHERE order_id = $1 ORDER BY product_id`;
}

function toOrder(row, items) {
  return { ...row, amount: Number(row.amount), order_items: items };
}

export async function listPublicProducts() {
  const result = await query(
    pool,
    `SELECT id, name, category, sku, price, stock, icon
     FROM public.products
     WHERE active = true AND stock > 0
     ORDER BY name ASC`
  );
  return result.rows;
}

export async function listAdminProducts() {
  const result = await query(
    pool,
    `SELECT id, name, category, sku, price, stock, icon, active
     FROM public.products
     WHERE active = true
     ORDER BY name ASC`
  );
  return result.rows;
}

export async function getProductsByIds(productIds) {
  const result = await query(
    pool,
    `SELECT id, name, price, stock, active
     FROM public.products
     WHERE id = ANY($1::text[])`,
    [productIds]
  );
  return result.rows;
}

export async function listAdminOrders() {
  const result = await query(
    pool,
    `SELECT o.*,
       COALESCE(
         jsonb_agg(jsonb_build_object(
           'product_id', oi.product_id,
           'product_name', oi.product_name,
           'quantity', oi.quantity,
           'unit_price', oi.unit_price
         ) ORDER BY oi.product_id) FILTER (WHERE oi.order_id IS NOT NULL),
         '[]'::jsonb
       ) AS order_items
     FROM public.orders o
     LEFT JOIN public.order_items oi ON oi.order_id = o.id
     GROUP BY o.id
     ORDER BY o.created_at DESC`
  );
  return result.rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}

export async function createOrder(contact, items, paymentStatus, paymentMethod) {
  return transaction(async (client) => {
    const orderedItems = [...items].sort((a, b) => a.productId.localeCompare(b.productId));
    const products = [];
    let amount = 0;

    for (const item of orderedItems) {
      const result = await query(
        client,
        `SELECT id, name, price, stock, active
         FROM public.products WHERE id = $1 FOR UPDATE`,
        [item.productId]
      );
      const product = result.rows[0];
      if (!product || !product.active || product.stock < item.quantity) {
        throw Object.assign(
          new Error(`Sorry, ${product?.name || "an item"} is no longer available in that quantity.`),
          { status: 409 }
        );
      }
      amount += product.price * item.quantity;
      products.push({ ...product, quantity: item.quantity });
    }

    const sequence = await query(client, "SELECT nextval('public.order_number_seq') AS number");
    const orderId = `OR-${sequence.rows[0].number}`;
    const orderResult = await query(
      client,
      `INSERT INTO public.orders (
         id, customer, phone, fulfillment, delivery_address, note, amount,
         payment_status, payment_method
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        orderId,
        contact.customer.trim(),
        contact.phone,
        contact.fulfillment,
        contact.fulfillment === "delivery" ? contact.address.trim() : "",
        contact.note.trim(),
        amount,
        paymentStatus,
        paymentMethod
      ]
    );

    const orderItems = [];
    for (const product of products) {
      await query(
        client,
        "UPDATE public.products SET stock = stock - $1 WHERE id = $2",
        [product.quantity, product.id]
      );
      const itemResult = await query(
        client,
        `INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING product_id, product_name, quantity, unit_price`,
        [orderId, product.id, product.name, product.quantity, product.price]
      );
      orderItems.push(itemResult.rows[0]);
    }

    return toOrder(orderResult.rows[0], orderItems);
  });
}

export async function attachStripeSession(orderId, sessionId) {
  const result = await query(
    pool,
    "UPDATE public.orders SET stripe_session_id = $1 WHERE id = $2",
    [sessionId, orderId]
  );
  return result.rowCount > 0;
}

export async function getOrderForCancellation(orderId) {
  const result = await query(
    pool,
    `SELECT id, payment_status, stripe_session_id
     FROM public.orders WHERE id = $1 LIMIT 1`,
    [orderId]
  );
  return result.rows[0] || null;
}

export async function getOrderByStripeSession(sessionId) {
  const result = await query(
    pool,
    `SELECT id, payment_status, stripe_session_id
     FROM public.orders WHERE stripe_session_id = $1 LIMIT 1`,
    [sessionId]
  );
  return result.rows[0] || null;
}

export async function markStripeOrderPaid(sessionId) {
  const result = await query(
    pool,
    `UPDATE public.orders
     SET payment_status = 'Paid', payment_method = 'Visa/Mastercard via Stripe'
     WHERE stripe_session_id = $1`,
    [sessionId]
  );
  return result.rowCount > 0;
}

export async function updateOrderPayment(orderId, paymentStatus, paymentMethod) {
  const result = await query(
    pool,
    `UPDATE public.orders SET payment_status = $1, payment_method = $2
     WHERE id = $3`,
    [paymentStatus, paymentMethod, orderId]
  );
  return result.rowCount > 0;
}

export async function cancelOrder(orderId) {
  return transaction(async (client) => {
    const result = await query(
      client,
      "SELECT id, status, payment_status FROM public.orders WHERE id = $1 FOR UPDATE",
      [orderId]
    );
    const order = result.rows[0];
    if (!order) throw Object.assign(new Error("Order not found."), { status: 404 });
    if (order.status === "Cancelled") return;
    if (order.payment_status === "Paid") {
      throw Object.assign(new Error("Paid orders cannot be automatically cancelled."), { status: 409 });
    }

    const items = await query(client, orderItemsQuery(), [orderId]);
    for (const item of items.rows) {
      await query(
        client,
        "UPDATE public.products SET stock = stock + $1 WHERE id = $2",
        [item.quantity, item.product_id]
      );
    }
    await query(
      client,
      `UPDATE public.orders SET status = 'Cancelled', payment_status = 'Failed'
       WHERE id = $1`,
      [orderId]
    );
  });
}

export async function setOrderStatus(orderId, status) {
  return transaction(async (client) => {
    const result = await query(
      client,
      "SELECT id, status, payment_status FROM public.orders WHERE id = $1 FOR UPDATE",
      [orderId]
    );
    const order = result.rows[0];
    if (!order) throw Object.assign(new Error("Order not found."), { status: 404 });
    if (order.status === status) return;
    if (order.payment_status === "Paid" && status === "Cancelled") {
      throw Object.assign(new Error("Paid orders must be refunded before cancellation."), { status: 409 });
    }

    const items = await query(client, orderItemsQuery(), [orderId]);
    if (order.status === "Cancelled" && status !== "Cancelled") {
      const productIds = items.rows.map((item) => item.product_id).sort();
      const products = await query(
        client,
        `SELECT id, stock, active FROM public.products
         WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
        [productIds]
      );
      const productsById = new Map(products.rows.map((product) => [product.id, product]));
      for (const item of items.rows) {
        const product = productsById.get(item.product_id);
        if (!product || !product.active || product.stock < item.quantity) {
          throw Object.assign(
            new Error("There is not enough stock to reopen this order."),
            { status: 409 }
          );
        }
      }
      for (const item of items.rows) {
        await query(
          client,
          "UPDATE public.products SET stock = stock - $1 WHERE id = $2",
          [item.quantity, item.product_id]
        );
      }
    } else if (order.status !== "Cancelled" && status === "Cancelled") {
      for (const item of items.rows) {
        await query(
          client,
          "UPDATE public.products SET stock = stock + $1 WHERE id = $2",
          [item.quantity, item.product_id]
        );
      }
    }
    await query(client, "UPDATE public.orders SET status = $1 WHERE id = $2", [status, orderId]);
  });
}

export async function deleteOrder(orderId) {
  return transaction(async (client) => {
    const result = await query(
      client,
      "SELECT id, status, payment_status FROM public.orders WHERE id = $1 FOR UPDATE",
      [orderId]
    );
    const order = result.rows[0];
    if (!order) throw Object.assign(new Error("Order not found."), { status: 404 });
    if (order.payment_status === "Paid") {
      throw Object.assign(new Error("Paid orders cannot be deleted."), { status: 409 });
    }

    if (order.status !== "Cancelled") {
      const items = await query(client, orderItemsQuery(), [orderId]);
      for (const item of items.rows) {
        await query(
          client,
          "UPDATE public.products SET stock = stock + $1 WHERE id = $2",
          [item.quantity, item.product_id]
        );
      }
    }
    await query(client, "DELETE FROM public.orders WHERE id = $1", [orderId]);
  });
}

export async function createProduct(product) {
  const result = await query(
    pool,
    `INSERT INTO public.products (id, name, category, sku, price, stock, icon, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true)
     RETURNING id, name, category, sku, price, stock, icon, active`,
    [
      product.id,
      product.name,
      product.category,
      product.sku,
      product.price,
      product.stock,
      product.icon
    ]
  );
  return result.rows[0];
}

export async function productHasOrderHistory(productId) {
  const result = await query(
    pool,
    "SELECT EXISTS (SELECT 1 FROM public.order_items WHERE product_id = $1) AS exists",
    [productId]
  );
  return result.rows[0].exists;
}

export async function deactivateProduct(productId) {
  const result = await query(
    pool,
    `UPDATE public.products SET active = false
     WHERE id = $1 AND active = true
     RETURNING id`,
    [productId]
  );
  return result.rowCount > 0;
}
