import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  attachStripeSession,
  cancelOrder,
  createOrder as databaseCreateOrder,
  createProduct,
  databaseConfigured,
  deactivateProduct,
  deleteOrder,
  getOrderByStripeSession,
  getOrderForCancellation,
  getProductsByIds,
  listAdminOrders,
  listAdminProducts,
  listPublicProducts,
  markStripeOrderPaid,
  productHasOrderHistory,
  setOrderStatus,
  updateOrderPayment
} from "./database.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const appUrl = new URL(process.env.APP_URL || `http://localhost:${port}`);
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const adminUsername = process.env.ADMIN_USERNAME || "";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const sessionSecret = process.env.SESSION_SECRET || "";
const sessionCookie = "bravo_session";
const sessionMaxAge = 8 * 60 * 60;
const loginAttempts = new Map();
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};
const servedFiles = new Set(["index.html", "styles.css", "app.js"]);

function configurationStatus() {
  const database = databaseConfigured;
  const staffLogin = Boolean(adminUsername && adminPassword && sessionSecret.length >= 32);
  const publicUrl = !process.env.K_SERVICE || Boolean(process.env.APP_URL);
  return {
    database,
    staffLogin,
    publicUrl,
    payments: Boolean(stripeSecretKey && stripeWebhookSecret),
    ready: database && staffLogin && publicUrl
  };
}

function sendJson(response, status, data, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(data));
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

async function readBody(request, maximum = 16_384) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximum) throw Object.assign(new Error("Request is too large."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const body = await readBody(request);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON request."), { status: 400 });
  }
}

function requireConfiguration(response, keys) {
  const config = configurationStatus();
  if (keys.some((key) => !config[key])) {
    sendError(response, 503, "This service is not fully configured yet. Contact the store administrator.");
    return false;
  }
  return true;
}

async function stripeRequest(endpoint, values, method = "POST") {
  const response = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      ...(values ? { "Content-Type": "application/x-www-form-urlencoded" } : {})
    },
    body: values ? new URLSearchParams(values) : undefined
  });
  const result = await response.json();
  if (!response.ok) {
    console.error("Stripe API request failed:", result.error?.message || response.statusText);
    throw Object.assign(new Error("Card checkout is unavailable. Try again later or contact the store."), { status: 502 });
  }
  return result;
}

function requestOriginIsValid(request) {
  return request.headers.origin === appUrl.origin;
}

function secureCookie(request, value, maxAge) {
  const secure = appUrl.protocol === "https:" || request.headers["x-forwarded-proto"] === "https";
  return `${sessionCookie}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function sessionToken(username, expiresAt) {
  const payload = Buffer.from(`${username}\n${expiresAt}\n${randomBytes(16).toString("hex")}`).toString("base64url");
  const signature = createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function hasStaffSession(request) {
  if (sessionSecret.length < 32) return false;
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookie}=`));
  if (!cookie) return false;
  const token = cookie.slice(sessionCookie.length + 1);
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = createHmac("sha256", sessionSecret).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const [username, expiry] = Buffer.from(payload, "base64url").toString("utf8").split("\n");
    return username === adminUsername && Number(expiry) > Date.now();
  } catch {
    return false;
  }
}

function sameSecret(input, expected) {
  const inputDigest = createHmac("sha256", sessionSecret).update(input).digest();
  const expectedDigest = createHmac("sha256", sessionSecret).update(expected).digest();
  return timingSafeEqual(inputDigest, expectedDigest);
}

function loginIsLimited(request) {
  const address = request.headers["x-forwarded-for"]?.split(",").at(-1)?.trim() || request.socket.remoteAddress || "unknown";
  const attempt = loginAttempts.get(address);
  if (!attempt || attempt.resetAt <= Date.now()) return { limited: false, address };
  return { limited: attempt.count >= 8, address };
}

function recordFailedLogin(address) {
  const attempt = loginAttempts.get(address);
  if (!attempt || attempt.resetAt <= Date.now()) {
    loginAttempts.set(address, { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
    return;
  }
  attempt.count += 1;
}

function validateContact(data) {
  const customer = String(data.customer || "").trim();
  const phone = String(data.phone || "").trim();
  const phoneDigits = phone.replace(/\D/g, "");
  const fulfillment = String(data.fulfillment || "");
  const address = String(data.address || "").trim();
  const note = String(data.note || "").trim();
  if (!customer || customer.length > 70 || phone.length > 24 || !/^\+?[0-9\s().-]+$/.test(phone) ||
      phoneDigits.length < 7 || phoneDigits.length > 15 ||
      !["delivery", "pickup"].includes(fulfillment) || (fulfillment === "delivery" && (!address || address.length > 180)) ||
      note.length > 240) {
    throw Object.assign(new Error("Enter a valid name, telephone number, and pickup or delivery details."), { status: 400 });
  }
  return { customer, phone, fulfillment, address: fulfillment === "delivery" ? address : "", note };
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw Object.assign(new Error("Choose between 1 and 20 products."), { status: 400 });
  }
  const merged = new Map();
  for (const item of items) {
    const productId = String(item?.productId || "");
    const quantity = Number(item?.quantity);
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw Object.assign(new Error("A product or quantity is invalid."), { status: 400 });
    }
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }
  const normalized = [...merged].map(([productId, quantity]) => ({ productId, quantity }));
  if (normalized.some((item) => item.quantity > 99)) {
    throw Object.assign(new Error("The requested quantity is too large."), { status: 400 });
  }
  return normalized;
}

async function expireStripeSession(sessionId) {
  try {
    await stripeRequest(`checkout/sessions/${sessionId}/expire`, {});
  } catch (error) {
    console.error("Could not expire unused Stripe checkout:", error.message);
  }
}

async function closePendingCheckout(order) {
  if (!order.stripe_session_id || order.payment_status !== "Pending") return;
  if (!stripeSecretKey) {
    throw Object.assign(new Error("Card checkout is not configured, so this order cannot be cancelled yet."), { status: 503 });
  }
  const session = await stripeRequest(`checkout/sessions/${order.stripe_session_id}`, null, "GET");
  if (session.payment_status === "paid") {
    await markStripeOrderPaid(order.stripe_session_id);
    throw Object.assign(new Error("This order has already been paid and cannot be cancelled or deleted without a refund."), { status: 409 });
  }
  if (session.status === "open") {
    await stripeRequest(`checkout/sessions/${session.id}/expire`, {});
  } else if (session.status !== "expired") {
    throw Object.assign(new Error("This card checkout is still processing and cannot be cancelled yet."), { status: 409 });
  }
}

function orderItems(order) {
  return (order.order_items || []).map((item) => ({
    productId: item.product_id,
    name: item.product_name,
    quantity: item.quantity,
    unitPrice: item.unit_price
  }));
}

function publicProduct(product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    sku: product.sku,
    price: product.price,
    stock: product.stock,
    icon: product.icon
  };
}

function publicOrder(order) {
  return {
    id: order.id,
    customer: order.customer,
    phone: order.phone || "",
    productId: order.order_items?.[0]?.product_id,
    quantity: (order.order_items || []).reduce((sum, item) => sum + item.quantity, 0),
    items: orderItems(order),
    fulfillment: order.fulfillment,
    deliveryAddress: order.delivery_address,
    note: order.note,
    amount: order.amount,
    status: order.status,
    paymentStatus: order.payment_status,
    paymentMethod: order.payment_method,
    createdAt: order.created_at
  };
}

async function createOrder(contact, items, paymentStatus, paymentMethod) {
  return databaseCreateOrder(contact, items, paymentStatus, paymentMethod);
}

async function createCustomerCheckout(request, response) {
  if (!requestOriginIsValid(request)) {
    sendError(response, 403, "Request origin was not accepted.");
    return;
  }
  if (!requireConfiguration(response, ["database"])) return;
  const data = await readJson(request);
  const contact = validateContact(data);
  const items = validateItems(data.items);
  if (!stripeSecretKey || !stripeWebhookSecret) {
    const order = await createOrder(contact, items, "Unpaid", "Pay later");
    sendJson(response, 201, { orderId: order.id, paymentStatus: order.payment_status });
    return;
  }
  const products = await getProductsByIds(items.map((item) => item.productId));
  const productsById = new Map(products.map((product) => [product.id, product]));
  const lineItems = items.map((item, index) => {
    const product = productsById.get(item.productId);
    if (!product || !product.active || product.stock < item.quantity) {
      throw Object.assign(new Error(`Sorry, ${product?.name || "an item"} is no longer available in that quantity.`), { status: 409 });
    }
    return {
      [`line_items[${index}][price_data][currency]`]: "ugx",
      [`line_items[${index}][price_data][unit_amount]`]: String(product.price * 100),
      [`line_items[${index}][price_data][product_data][name]`]: product.name,
      [`line_items[${index}][quantity]`]: String(item.quantity)
    };
  });
  const stripeValues = {
    mode: "payment",
    "payment_method_types[0]": "card",
    success_url: new URL("/?shop&payment=success&session_id={CHECKOUT_SESSION_ID}", appUrl).href,
    cancel_url: new URL("/?shop&payment=cancelled&session_id={CHECKOUT_SESSION_ID}", appUrl).href,
    ...Object.assign({}, ...lineItems)
  };

  const session = await stripeRequest("checkout/sessions", stripeValues);
  let order;
  try {
    order = await createOrder(contact, items, "Pending", "Visa/Mastercard via Stripe");
    if (!await attachStripeSession(order.id, session.id)) {
      throw new Error("The payment session could not be attached to the order.");
    }
  } catch (error) {
    await expireStripeSession(session.id);
    if (order) {
      try {
        await cancelOrder(order.id);
      } catch (cancelError) {
        console.error("Could not release stock for a failed checkout:", cancelError.message);
      }
    }
    throw error;
  }
  sendJson(response, 200, { checkoutUrl: session.url });
}

function verifyStripeSignature(payload, signatureHeader) {
  if (!stripeWebhookSecret || !signatureHeader) return false;
  const parts = signatureHeader.split(",").map((part) => part.split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", stripeWebhookSecret).update(`${timestamp}.${payload}`).digest();
  return signatures.some((signature) => {
    const actual = Buffer.from(signature, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

async function handleStripeWebhook(request, response) {
  if (!requireConfiguration(response, ["database", "payments"])) return;
  const payload = await readBody(request, 1_000_000);
  if (!verifyStripeSignature(payload, request.headers["stripe-signature"])) {
    sendError(response, 400, "Invalid payment signature.");
    return;
  }
  let event;
  try {
    event = JSON.parse(payload.toString("utf8"));
  } catch {
    sendError(response, 400, "Invalid payment event.");
    return;
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data?.object;
    if (session?.payment_status === "paid") {
      await markStripeOrderPaid(session.id);
    }
  } else if (event.type === "checkout.session.expired") {
    const session = event.data?.object;
    if (session?.id) {
      const order = await getOrderByStripeSession(session.id);
      if (order?.payment_status === "Pending") await cancelOrder(order.id);
    }
  }
  sendJson(response, 200, { received: true });
}

async function handleCheckoutReturn(request, response, sessionId, result) {
  if (!requireConfiguration(response, ["database", "payments"])) return;
  if (!/^cs_(?:test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    sendError(response, 400, "Invalid checkout session.");
    return;
  }
  const session = await stripeRequest(`checkout/sessions/${sessionId}`, null, "GET");
  const order = await getOrderByStripeSession(session.id);
  if (!order) {
    sendError(response, 404, "The order for this checkout could not be found.");
    return;
  }
  if (session.payment_status === "paid" && order.payment_status !== "Paid") {
    await markStripeOrderPaid(session.id);
    order.payment_status = "Paid";
  }
  if ((session.status === "expired" || result === "cancelled") && order.payment_status === "Pending") {
    if (session.status === "open") await stripeRequest(`checkout/sessions/${session.id}/expire`, {});
    await cancelOrder(order.id);
  }
  sendJson(response, 200, { orderId: order.id, paymentStatus: order.payment_status });
}

async function handleApi(request, response, url) {
  const path = url.pathname;
  const method = request.method;

  if (method === "GET" && path === "/api/health") {
    const status = configurationStatus();
    sendJson(response, 200, { configured: status.ready, payments: status.payments, mode: "online" });
    return;
  }

  if (method === "GET" && path === "/api/session") {
    sendJson(response, 200, { authenticated: hasStaffSession(request) });
    return;
  }

  if (method === "POST" && path === "/api/login") {
    if (!requestOriginIsValid(request)) {
      sendError(response, 403, "Request origin was not accepted.");
      return;
    }
    if (!requireConfiguration(response, ["staffLogin"])) return;
    const attempt = loginIsLimited(request);
    if (attempt.limited) {
      sendError(response, 429, "Too many sign-in attempts. Wait 15 minutes and try again.");
      return;
    }
    const data = await readJson(request);
    const username = String(data.username || "");
    const password = String(data.password || "");
    if (!sameSecret(username, adminUsername) || !sameSecret(password, adminPassword)) {
      recordFailedLogin(attempt.address);
      sendError(response, 401, "The username or password was not accepted.");
      return;
    }
    loginAttempts.delete(attempt.address);
    const expiresAt = Date.now() + sessionMaxAge * 1000;
    sendJson(response, 200, { authenticated: true }, { "Set-Cookie": secureCookie(request, sessionToken(adminUsername, expiresAt), sessionMaxAge) });
    return;
  }

  if (method === "POST" && path === "/api/logout") {
    if (!requestOriginIsValid(request)) {
      sendError(response, 403, "Request origin was not accepted.");
      return;
    }
    sendJson(response, 200, { authenticated: false }, { "Set-Cookie": secureCookie(request, "", 0) });
    return;
  }

  if (method === "POST" && path === "/api/stripe-webhook") {
    await handleStripeWebhook(request, response);
    return;
  }

  if (method === "POST" && path === "/api/orders") {
    await createCustomerCheckout(request, response);
    return;
  }

  if (method === "GET" && path === "/api/products") {
    if (!requireConfiguration(response, ["database"])) return;
    const products = await listPublicProducts();
    sendJson(response, 200, products.map(publicProduct));
    return;
  }

  const checkoutMatch = path.match(/^\/api\/checkout-sessions\/(cs_(?:test|live)_[A-Za-z0-9]+)$/);
  if (method === "GET" && checkoutMatch) {
    await handleCheckoutReturn(request, response, checkoutMatch[1], url.searchParams.get("result"));
    return;
  }

  if (!hasStaffSession(request)) {
    sendError(response, 401, "Sign in to access the staff dashboard.");
    return;
  }

  if (method === "GET" && path === "/api/admin/state") {
    if (!requireConfiguration(response, ["database"])) return;
    const [products, orders] = await Promise.all([
      listAdminProducts(),
      listAdminOrders()
    ]);
    sendJson(response, 200, {
      products: products.map(publicProduct),
      orders: orders.map(publicOrder)
    });
    return;
  }

  if (method === "POST" && path === "/api/admin/orders") {
    if (!requestOriginIsValid(request) || !requireConfiguration(response, ["database"])) {
      if (response.headersSent) return;
      sendError(response, 403, "Request origin was not accepted.");
      return;
    }
    const data = await readJson(request);
    const contact = validateContact({ ...data, fulfillment: data.fulfillment || "pickup" });
    const items = validateItems(data.items);
    const paymentStatus = data.paymentStatus === "Paid" ? "Paid" : "Unpaid";
    const paymentMethod = String(data.paymentMethod || (paymentStatus === "Paid" ? "Cash" : "Pay later")).slice(0, 40);
    const order = await createOrder(contact, items, paymentStatus, paymentMethod);
    sendJson(response, 201, publicOrder(order));
    return;
  }

  const statusMatch = path.match(/^\/api\/admin\/orders\/([^/]+)\/status$/);
  if (method === "PATCH" && statusMatch) {
    if (!requestOriginIsValid(request)) {
      sendError(response, 403, "Request origin was not accepted.");
      return;
    }
    const data = await readJson(request);
    if (!["Pending", "Processing", "Shipped", "Delivered", "Cancelled"].includes(data.status)) {
      sendError(response, 400, "Choose a valid order status.");
      return;
    }
    const orderId = decodeURIComponent(statusMatch[1]);
    if (data.status === "Cancelled") {
      const order = await getOrderForCancellation(orderId);
      if (!order) {
        sendError(response, 404, "Order not found.");
        return;
      }
      await closePendingCheckout(order);
    }
    await setOrderStatus(orderId, data.status);
    sendJson(response, 200, { updated: true });
    return;
  }

  const paymentMatch = path.match(/^\/api\/admin\/orders\/([^/]+)\/payment$/);
  if (method === "PATCH" && paymentMatch) {
    if (!requestOriginIsValid(request)) {
      sendError(response, 403, "Request origin was not accepted.");
      return;
    }
    const data = await readJson(request);
    const options = {
      unpaid: ["Unpaid", "Pay later"],
      paid_cash: ["Paid", "Cash"],
      paid_visa: ["Paid", "Visa (record only)"],
      paid_mastercard: ["Paid", "Mastercard (record only)"],
      paid_bank: ["Paid", "Bank transfer"],
      paid_other: ["Paid", "Other"]
    };
    const payment = options[data.paymentOption];
    if (!payment) {
      sendError(response, 400, "Choose a valid payment option.");
      return;
    }
    const updated = await updateOrderPayment(
      decodeURIComponent(paymentMatch[1]),
      payment[0],
      payment[1]
    );
    if (!updated) {
      sendError(response, 404, "Order not found.");
      return;
    }
    sendJson(response, 200, { updated: true });
    return;
  }

  const deleteOrderMatch = path.match(/^\/api\/admin\/orders\/([^/]+)$/);
  if (method === "DELETE" && deleteOrderMatch) {
    if (!requestOriginIsValid(request)) {
      sendError(response, 403, "Request origin was not accepted.");
      return;
    }
    const orderId = decodeURIComponent(deleteOrderMatch[1]);
    const order = await getOrderForCancellation(orderId);
    if (!order) {
      sendError(response, 404, "Order not found.");
      return;
    }
    await closePendingCheckout(order);
    await deleteOrder(orderId);
    sendJson(response, 200, { deleted: true });
    return;
  }

  if (method === "POST" && path === "/api/admin/products") {
    if (!requestOriginIsValid(request)) {
      sendError(response, 403, "Request origin was not accepted.");
      return;
    }
    const data = await readJson(request);
    const name = String(data.name || "").trim();
    const category = String(data.category || "").trim();
    const price = Number(data.price);
    const stock = Number(data.stock);
    if (!name || name.length > 70 || !category || category.length > 40 ||
        !Number.isSafeInteger(price) || price < 1 || !Number.isSafeInteger(stock) || stock < 0) {
      sendError(response, 400, "Enter a product name and category, a whole-number UGX price, and whole-number stock.");
      return;
    }
    const skuBase = name.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 3) || "NEW";
    const product = await createProduct({
      id: `p${randomUUID().replace(/-/g, "")}`,
      name,
      category,
      sku: `${skuBase}-${randomBytes(3).toString("hex").toUpperCase()}`,
      price,
      stock,
      icon: "◈"
    });
    sendJson(response, 201, publicProduct(product));
    return;
  }

  if (method === "DELETE" && path.startsWith("/api/admin/products/")) {
    if (!requestOriginIsValid(request)) {
      sendError(response, 403, "Request origin was not accepted.");
      return;
    }
    const productId = decodeURIComponent(path.slice("/api/admin/products/".length));
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(productId)) {
      sendError(response, 400, "Invalid product.");
      return;
    }
    if (await productHasOrderHistory(productId)) {
      sendError(response, 409, "This product has order history and cannot be deleted.");
      return;
    }
    if (!await deactivateProduct(productId)) {
      sendError(response, 404, "Product not found.");
      return;
    }
    sendJson(response, 200, { deleted: true });
    return;
  }

  sendError(response, 404, "API route not found.");
}

async function serveStatic(url, request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400);
    response.end("Invalid path");
    return;
  }
  const fileName = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!servedFiles.has(fileName)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const file = resolve(root, fileName);
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const content = await readFile(file);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(file)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'",
      "Cache-Control": fileName === "index.html" ? "no-cache" : "public, max-age=300"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    throw error;
  }
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, appUrl);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(url, request, response);
    } else {
      sendError(response, 405, "Method not allowed.");
    }
  } catch (error) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    console.error("Request failed:", error);
    sendError(response, error.status || 500, error.status ? error.message : "The server could not complete the request.");
  }
}).listen(port, host, () => {
  console.log(`Bravo Express is available on ${host}:${port}`);
});
