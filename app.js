const STORAGE_KEY = "orbit-sales-orders-v1";
const demoMode = location.protocol === "file:" || location.hostname.endsWith(".github.io");

const initialState = {
  products: [
    { id: "p1", name: "Everyday Tote", category: "Bags & accessories", sku: "BAG-001", price: 48, stock: 7, icon: "◈" },
    { id: "p2", name: "Ceramic Pour-over Set", category: "Home & living", sku: "HOM-014", price: 72, stock: 4, icon: "◒" },
    { id: "p3", name: "Linen Desk Pad", category: "Workspace", sku: "DSK-008", price: 36, stock: 22, icon: "▱" },
    { id: "p4", name: "The Daily Journal", category: "Stationery", sku: "STA-021", price: 24, stock: 3, icon: "▤" },
    { id: "p5", name: "Stoneware Mug", category: "Home & living", sku: "HOM-006", price: 32, stock: 16, icon: "◡" },
    { id: "p6", name: "Canvas Market Bag", category: "Bags & accessories", sku: "BAG-009", price: 29, stock: 0, icon: "⌑" }
  ],
  orders: [
    { id: "OR-1048", customer: "Olivia Rhye", phone: "", productId: "p3", quantity: 1, amount: 36, status: "Delivered", createdAt: daysAgo(0) },
    { id: "OR-1047", customer: "Phoenix Baker", phone: "", productId: "p1", quantity: 2, amount: 96, status: "Processing", createdAt: daysAgo(0) },
    { id: "OR-1046", customer: "Lana Steiner", phone: "", productId: "p5", quantity: 1, amount: 32, status: "Shipped", createdAt: daysAgo(1) },
    { id: "OR-1045", customer: "Demi Wilkinson", phone: "", productId: "p2", quantity: 1, amount: 72, status: "Pending", createdAt: daysAgo(2) },
    { id: "OR-1044", customer: "Candice Wu", phone: "", productId: "p3", quantity: 2, amount: 72, status: "Delivered", createdAt: daysAgo(3) },
    { id: "OR-1043", customer: "Natali Craig", phone: "", productId: "p4", quantity: 1, amount: 24, status: "Delivered", createdAt: daysAgo(4) },
    { id: "OR-1042", customer: "Drew Cano", phone: "", productId: "p5", quantity: 2, amount: 64, status: "Processing", createdAt: daysAgo(6) },
    { id: "OR-1041", customer: "Orlando Diggs", phone: "", productId: "p3", quantity: 1, amount: 36, status: "Delivered", createdAt: daysAgo(8) },
    { id: "OR-1040", customer: "Andi Lane", phone: "", productId: "p1", quantity: 1, amount: 48, status: "Delivered", createdAt: daysAgo(12) },
    { id: "OR-1039", customer: "Kate Morrison", phone: "", productId: "p5", quantity: 1, amount: 32, status: "Cancelled", createdAt: daysAgo(18) }
  ]
};

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.products) && Array.isArray(saved.orders)) return saved;
  } catch (error) {
    console.error("Could not load saved store data:", error);
    showToast("Saved data could not be loaded. Starting with sample data.", true);
  }
  return structuredClone(initialState);
}

let state = loadState();
let activeView = "dashboard";
let customerCart = new Map();
let toastTimer;
let onlinePaymentsAvailable = false;
let onlineOrdersAvailable = false;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = (amount) => new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", currencyDisplay: "code", maximumFractionDigits: 0 }).format(amount || 0);
const formatDate = (value) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
const shortDate = (value) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const initials = (name) => name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
const sortedOrders = () => [...state.orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
const productFor = (id) => state.products.find((product) => product.id === id);
const orderItemsFor = (order) => Array.isArray(order.items) && order.items.length
  ? order.items
  : [{ productId: order.productId, quantity: order.quantity, unitPrice: productFor(order.productId)?.price || order.amount / order.quantity }];
const isRecognizedSale = (order) => order.status !== "Cancelled" && order.paymentStatus !== "Unpaid";

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    });
  } catch (error) {
    console.error("Could not reach the Bravo Express server:", error);
    throw new Error("Could not reach the store server. Check your connection and try again.");
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The store server returned an invalid response.");
  }
  if (!response.ok) {
    const error = new Error(result.error || "The store could not complete the request.");
    error.status = response.status;
    throw error;
  }
  return result;
}
const paymentOptions = [
  { value: "unpaid", status: "Unpaid", method: "Pay later", label: "Unpaid — pay later" },
  { value: "paid_cash", status: "Paid", method: "Cash", label: "Paid — cash" },
  { value: "paid_visa", status: "Paid", method: "Visa (record only)", label: "Paid — Visa (record only)" },
  { value: "paid_mastercard", status: "Paid", method: "Mastercard (record only)", label: "Paid — Mastercard (record only)" },
  { value: "paid_bank", status: "Paid", method: "Bank transfer", label: "Paid — bank transfer" },
  { value: "paid_other", status: "Paid", method: "Other", label: "Paid — other method" }
];

function paymentOptionFor(order) {
  if (order.paymentStatus === "Unpaid") return "unpaid";
  if (order.paymentMethod?.startsWith("Visa")) return "paid_visa";
  if (order.paymentMethod?.startsWith("Mastercard")) return "paid_mastercard";
  if (order.paymentMethod === "Cash") return "paid_cash";
  if (order.paymentMethod === "Bank transfer") return "paid_bank";
  return "paid_other";
}

function saveState() {
  if (!demoMode) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Could not save store data:", error);
    showToast("Changes could not be saved in this browser.", true);
  }
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error-toast", isError);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function statusMarkup(status) {
  return `<span class="status-pill status-${status.toLowerCase()}">${escapeHtml(status)}</span>`;
}

function orderItemsSummary(order) {
  const items = orderItemsFor(order);
  const names = items.map((item) => productFor(item.productId)?.name || item.name || "Product").join(", ");
  const fulfillment = order.fulfillment ? ` · ${order.fulfillment}${order.deliveryAddress ? `: ${order.deliveryAddress}` : ""}` : "";
  const note = order.note ? ` · Note: ${order.note}` : "";
  return `${items.reduce((sum, item) => sum + item.quantity, 0)} ${items.length === 1 ? "item" : "items"} · ${names}${fulfillment}${note}`;
}

function customerMarkup(name, index = 0, details = "") {
  return `<div class="customer-cell"><span class="customer-initial tone-${index % 4}">${escapeHtml(initials(name))}</span><span class="customer-description"><span class="customer-name">${escapeHtml(name)}</span>${details ? `<small>${escapeHtml(details)}</small>` : ""}</span></div>`;
}

function renderOrderRows(orders, target) {
  target.innerHTML = orders.map((order, index) => `
    <tr>
      <td class="order-id">#${escapeHtml(order.id)}</td>
      <td>${customerMarkup(order.customer, index, [order.phone || "Phone not provided", orderItemsSummary(order)].join(" · "))}</td>
      <td>${formatDate(order.createdAt)}</td>
      <td>${money(order.amount)}</td>
      <td>${target.id === "all-orders" ? `<select class="payment-select" data-order-payment="${escapeHtml(order.id)}" aria-label="Update payment for ${escapeHtml(order.id)}">${paymentOptions.map((option) => `<option value="${option.value}"${paymentOptionFor(order) === option.value ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>` : `<span class="payment-pill ${order.paymentStatus === "Paid" ? "payment-paid" : order.paymentStatus === "Unpaid" ? "payment-unpaid" : "payment-unrecorded"}">${escapeHtml(order.paymentStatus || "Unrecorded")}${order.paymentMethod ? ` · ${escapeHtml(order.paymentMethod)}` : ""}</span>`}</td>
      <td>${target.id === "all-orders" ? `<select class="status-select status-${order.status.toLowerCase()}" data-order-status="${escapeHtml(order.id)}" aria-label="Update status for ${escapeHtml(order.id)}">${["Pending", "Processing", "Shipped", "Delivered", "Cancelled"].map((status) => `<option${status === order.status ? " selected" : ""}>${status}</option>`).join("")}</select>` : statusMarkup(order.status)}</td>
      <td>${target.id === "all-orders" ? `<button class="row-action" data-delete-order="${escapeHtml(order.id)}" aria-label="Delete order ${escapeHtml(order.id)}" title="Delete order">···</button>` : ""}</td>
    </tr>`).join("");
}

function renderDashboard() {
  const salesEl = $("#metric-sales");
  const ordersEl = $("#metric-orders");
  const averageEl = $("#metric-average");
  const customersEl = $("#metric-customers");
  const orderCountEl = $("#order-count");
  const inventoryTotalEl = $("#inventory-total");
  const inventoryLowEl = $("#inventory-low");
  if (!salesEl || !ordersEl || !averageEl || !customersEl || !orderCountEl || !inventoryTotalEl || !inventoryLowEl) return;

  const activeOrders = state.orders.filter((order) => order.status !== "Cancelled");
  const sales = activeOrders.filter(isRecognizedSale);
  const revenue = sales.reduce((sum, order) => sum + order.amount, 0);
  const customers = getCustomers();
  salesEl.textContent = money(revenue);
  ordersEl.textContent = String(activeOrders.length);
  averageEl.textContent = money(sales.length ? revenue / sales.length : 0);
  customersEl.textContent = String(customers.length);
  orderCountEl.textContent = String(state.orders.length);
  inventoryTotalEl.textContent = String(state.products.length);
  inventoryLowEl.textContent = String(state.products.filter((product) => product.stock < 10).length);
  renderChart();
  renderLowStock();
  const recentOrdersEl = $("#recent-orders");
  if (recentOrdersEl) renderOrderRows(sortedOrders().slice(0, 5), recentOrdersEl);
}

function renderChart() {
  const chartRange = $("#chart-range");
  const chartTotal = $("#chart-total");
  const chartYAxis = $("#chart-y-axis");
  const chartBars = $("#chart-bars");
  const chartXAxis = $("#chart-x-axis");
  if (!chartRange || !chartTotal || !chartYAxis || !chartBars || !chartXAxis) return;
  const range = Number(chartRange.value);
  if (!Number.isFinite(range) || range < 1) return;
  const now = new Date();
  const bins = Array.from({ length: range }, (_, index) => {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (range - index - 1));
    return { day, amount: 0 };
  });
  const start = bins[0].day;
  for (const order of state.orders) {
    if (!isRecognizedSale(order)) continue;
    const date = new Date(order.createdAt);
    date.setHours(0, 0, 0, 0);
    const index = Math.round((date - start) / 86400000);
    if (index >= 0 && index < bins.length) bins[index].amount += order.amount;
  }
  const max = Math.max(100, ...bins.map((bin) => bin.amount));
  const scale = Math.ceil(max / 100) * 100;
  $("#chart-total").textContent = money(bins.reduce((sum, bin) => sum + bin.amount, 0));
  $("#chart-y-axis").innerHTML = [scale, scale * .75, scale * .5, scale * .25, 0].map((value) => `<span>${value >= 1000 ? `$${(value / 1000).toFixed(value % 1000 ? 1 : 0)}k` : `$${value}`}</span>`).join("");
  $("#chart-bars").innerHTML = bins.map((bin, index) => {
    const height = bin.amount ? Math.max(4, bin.amount / scale * 100) : 2;
    return `<div class="bar-group"><div class="bar ${index === bins.length - 1 ? "today" : ""}" style="height:${height}%"><span class="bar-tooltip">${money(bin.amount)}</span></div></div>`;
  }).join("");
  const labelIndices = new Set([0, Math.floor((range - 1) / 3), Math.floor((range - 1) * 2 / 3), range - 1]);
  $("#chart-x-axis").innerHTML = bins.map((bin, index) => `<span>${labelIndices.has(index) ? new Intl.DateTimeFormat("en-US", { weekday: range <= 7 ? "short" : undefined, month: range > 7 ? "short" : undefined, day: range > 7 ? "numeric" : undefined }).format(bin.day) : ""}</span>`).join("");
}

function renderLowStock() {
  const lowStockList = $("#low-stock-list");
  if (!lowStockList) return;
  const low = state.products.filter((product) => product.stock < 10).sort((a, b) => a.stock - b.stock).slice(0, 3);
  lowStockList.innerHTML = low.length ? low.map((product, index) => `<div class="low-stock-item"><span class="product-thumb ${index === 1 ? "peach" : index === 2 ? "blue" : ""}">${escapeHtml(product.icon || "◈")}</span><span class="low-stock-name"><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.category)}</span></span><span class="stock-badge">${product.stock === 0 ? "Out of stock" : `${product.stock} left`}</span></div>`).join("") : `<div class="no-low-stock">Everything is well stocked ✨</div>`;
}

function renderOrders() {
  const ordersSearch = $("#orders-search");
  const statusFilter = $("#status-filter");
  const paymentFilter = $("#payment-filter");
  const allOrders = $("#all-orders");
  const ordersEmpty = $("#orders-empty");
  if (!ordersSearch || !statusFilter || !paymentFilter || !allOrders || !ordersEmpty) return;

  const query = ordersSearch.value.trim().toLowerCase();
  const status = statusFilter.value;
  const payment = paymentFilter.value;
  const filtered = sortedOrders().filter((order) => {
    const matchesQuery = `${order.id} ${order.customer} ${order.phone || ""}`.toLowerCase().includes(query);
    const matchesPayment = payment === "all" || (payment === "Unrecorded" ? !order.paymentStatus : order.paymentStatus === payment);

    return matchesQuery && matchesPayment && (status === "all" || order.status === status);
  });
  renderOrderRows(filtered, allOrders);
  ordersEmpty.classList.toggle("hidden", filtered.length > 0);
}

function renderProducts() {
  const productsSearch = $("#products-search");
  const stockFilter = $("#stock-filter");
  const productsTable = $("#products-table");
  const productsEmpty = $("#products-empty");
  const productsCount = $("#products-count");
  const productsValue = $("#products-value");
  const productsLow = $("#products-low");
  if (!productsSearch || !stockFilter || !productsTable || !productsEmpty || !productsCount || !productsValue || !productsLow) return;

  const query = productsSearch.value.trim().toLowerCase();
  const filter = stockFilter.value;
  const products = state.products.filter((product) => {
    const matchesQuery = `${product.name} ${product.category} ${product.sku}`.toLowerCase().includes(query);
    const matchesStock = filter === "all" || (filter === "low" && product.stock > 0 && product.stock < 10) || (filter === "out" && product.stock === 0);
    return matchesQuery && matchesStock;
  });
  productsTable.innerHTML = products.map((product, index) => {
    const stockClass = product.stock === 0 ? "stock-out" : product.stock < 10 ? "stock-low" : "stock-ok";
    const stockStatus = product.stock === 0 ? "Out of stock" : product.stock < 10 ? "Low stock" : "In stock";
    return `<tr><td><div class="product-name-cell"><span class="product-thumb ${index % 3 === 1 ? "peach" : index % 3 === 2 ? "blue" : ""}">${escapeHtml(product.icon || "◈")}</span><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category)}</small></span></div></td><td>${escapeHtml(product.sku)}</td><td>${money(product.price)}</td><td>${product.stock} units</td><td><span class="${stockClass}">${stockStatus}</span></td><td><button class="row-action" data-delete-product="${escapeHtml(product.id)}" aria-label="Delete ${escapeHtml(product.name)}" title="Delete product">···</button></td></tr>`;
  }).join("");
  productsEmpty.classList.toggle("hidden", products.length > 0);
  productsCount.textContent = String(state.products.length);
  productsValue.textContent = money(state.products.reduce((sum, product) => sum + product.price * product.stock, 0));
  productsLow.textContent = String(state.products.filter((product) => product.stock < 10).length);
}

function getCustomers() {
  const customerMap = new Map();
  for (const order of state.orders) {
    const phone = order.phone || "";
    const key = phone || order.id;
    const customer = customerMap.get(key) || { name: order.customer, phone, orders: 0, spent: 0, lastOrder: order.createdAt };
    customer.orders += 1;
    if (isRecognizedSale(order)) customer.spent += order.amount;
    if (new Date(order.createdAt) > new Date(customer.lastOrder)) customer.lastOrder = order.createdAt;
    customerMap.set(key, customer);
  }
  return [...customerMap.values()].sort((a, b) => new Date(b.lastOrder) - new Date(a.lastOrder));
}

function renderCustomers() {
  const customersSearch = $("#customers-search");
  const customersTable = $("#customers-table");
  const customersEmpty = $("#customers-empty");
  const customersCount = $("#customers-count");
  const returningCount = $("#returning-count");
  const customerSpend = $("#customer-spend");
  const customerListCount = $("#customer-list-count");
  if (!customersSearch || !customersTable || !customersEmpty || !customersCount || !returningCount || !customerSpend || !customerListCount) return;

  const allCustomers = getCustomers();
  const query = customersSearch.value.trim().toLowerCase();
  const customers = allCustomers.filter((customer) => `${customer.name} ${customer.phone}`.toLowerCase().includes(query));
  const returning = allCustomers.filter((customer) => customer.orders > 1).length;
  const totalSpend = allCustomers.reduce((sum, customer) => sum + customer.spent, 0);
  customersCount.textContent = String(allCustomers.length);
  returningCount.textContent = String(returning);
  customerSpend.textContent = money(allCustomers.length ? totalSpend / allCustomers.length : 0);
  customerListCount.textContent = `${customers.length} ${customers.length === 1 ? "customer" : "customers"}`;
  customersTable.innerHTML = customers.map((customer, index) => `<tr><td>${customerMarkup(customer.name, index)}</td><td>${escapeHtml(customer.phone || "Not provided")}</td><td>${customer.orders}</td><td>${money(customer.spent)}</td><td>${formatDate(customer.lastOrder)}</td></tr>`).join("");
  customersEmpty.classList.toggle("hidden", customers.length > 0);
}

function renderAll() {
  renderDashboard();
  renderOrders();
  renderProducts();
  renderCustomers();
  renderCustomerShop();
}

async function refreshAdminState() {
  const saved = await apiRequest("/api/admin/state");
  state.products = saved.products;
  state.orders = saved.orders;
  renderAll();
}

function navigate(view) {
  activeView = view;
  $$(".view-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `view-${view}`));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  const label = { dashboard: "Overview", orders: "Orders", products: "Products", customers: "Customers", shop: "Customer shop" }[view];
  $("#breadcrumb-current").textContent = label;
  $("#sidebar").classList.remove("open");
  if (view === "orders") renderOrders();
  if (view === "products") renderProducts();
  if (view === "customers") renderCustomers();
  if (view === "shop") renderCustomerShop();
}

function renderCustomerShop() {
  const grid = $("#shop-product-grid");
  const cartItems = $("#shop-cart-items");
  if (!grid || !cartItems) return;

  const availableProducts = state.products.filter((product) => product.stock > 0);
  $("#shop-product-count").textContent = `${availableProducts.length} ${availableProducts.length === 1 ? "piece" : "pieces"}`;
  grid.innerHTML = availableProducts.length ? availableProducts.map((product, index) => {
    const quantity = customerCart.get(product.id) || 0;
    return `<article class="shop-product-card">
      <div class="shop-product-art art-${index % 4}"><span class="product-thumb">${escapeHtml(product.icon || "◈")}</span><span class="shop-stock">${product.stock} in stock</span></div>
      <div class="shop-product-info"><span class="shop-product-category">${escapeHtml(product.category)}</span><h3>${escapeHtml(product.name)}</h3><div class="shop-product-buy"><strong>${money(product.price)}</strong><button class="button ${quantity ? "button-secondary" : "button-primary"}" type="button" data-shop-add="${escapeHtml(product.id)}" ${quantity >= product.stock ? "disabled" : ""}>${quantity ? `Add another (${quantity})` : "Add to bag"}</button></div></div>
    </article>`;
  }).join("") : `<div class="shop-empty-products">There are no in-stock products right now.</div>`;

  const lines = [...customerCart.entries()].map(([productId, quantity]) => ({ product: productFor(productId), quantity })).filter((line) => line.product);
  if (lines.length !== customerCart.size) customerCart = new Map(lines.map(({ product, quantity }) => [product.id, quantity]));
  cartItems.innerHTML = lines.length ? lines.map(({ product, quantity }) => `
    <div class="shop-cart-line">
      <span class="product-thumb">${escapeHtml(product.icon || "◈")}</span>
      <div class="shop-cart-product"><strong>${escapeHtml(product.name)}</strong><span>${money(product.price)} each</span><div class="shop-quantity"><button type="button" data-shop-quantity="${escapeHtml(product.id)}" data-step="-1" aria-label="Remove one ${escapeHtml(product.name)}">−</button><span>${quantity}</span><button type="button" data-shop-quantity="${escapeHtml(product.id)}" data-step="1" aria-label="Add one ${escapeHtml(product.name)}" ${quantity >= product.stock ? "disabled" : ""}>+</button></div></div>
      <div class="shop-cart-price"><strong>${money(product.price * quantity)}</strong><button type="button" data-shop-remove="${escapeHtml(product.id)}" aria-label="Remove ${escapeHtml(product.name)} from bag">Remove</button></div>
    </div>`).join("") : `<p class="shop-cart-empty">Your bag is waiting for something lovely.</p>`;
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  $("#shop-cart-count").textContent = `${itemCount} ${itemCount === 1 ? "item" : "items"}`;
  $("#shop-total").textContent = money(total);
  $("#shop-submit").disabled = !lines.length || (!demoMode && !onlineOrdersAvailable);
}

function updateShopCart(productId, step) {
  const product = productFor(productId);
  if (!product) return;
  const next = (customerCart.get(productId) || 0) + step;
  if (next <= 0) customerCart.delete(productId);
  else customerCart.set(productId, Math.min(next, product.stock));
  $("#shop-confirmation").classList.add("hidden");
  $("#customer-order-form").classList.remove("hidden");
  $("#shop-order-error").classList.add("hidden");
  renderCustomerShop();
}

async function submitCustomerOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $("#shop-order-error");
  const items = [...customerCart.entries()].map(([productId, quantity]) => {
    const product = productFor(productId);
    return product ? { product, quantity } : null;
  }).filter(Boolean);
  const fulfillment = form.elements.fulfillment.value;
  const address = form.elements.address.value.trim();
  if (!items.length) {
    error.textContent = "Add an in-stock item to your bag before placing an order.";
    error.classList.remove("hidden");
    return;
  }
  const unavailable = items.find(({ product, quantity }) => !Number.isInteger(quantity) || quantity < 1 || quantity > product.stock);
  if (unavailable) {
    error.textContent = `${unavailable.product.name} no longer has enough stock. Please update your bag.`;
    error.classList.remove("hidden");
    renderCustomerShop();
    return;
  }
  if (!["delivery", "pickup"].includes(fulfillment) || (fulfillment === "delivery" && !address)) {
    error.textContent = fulfillment === "delivery" ? "Enter a delivery address to continue." : "Choose delivery or pickup.";
    error.classList.remove("hidden");
    return;
  }

  if (!demoMode) {
    const submitButton = $("#shop-submit");
    const customerName = form.elements.customer.value.trim();
    submitButton.disabled = true;
    error.classList.add("hidden");
    try {
      const result = await apiRequest("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          customer: customerName,
          phone: form.elements.phone.value.trim(),
          fulfillment,
          address,
          note: form.elements.note.value.trim(),
          items: items.map(({ product, quantity }) => ({ productId: product.id, quantity }))
        })
      });
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      for (const { product, quantity } of items) product.stock -= quantity;
      customerCart.clear();
      form.reset();
      $("#shop-fulfillment").value = "delivery";
      $("#shop-address-field").classList.remove("hidden");
      customerOrderForm.elements.address.required = true;
      $("#shop-order-error").classList.add("hidden");
      $("#customer-order-form").classList.add("hidden");
      $("#shop-confirmation").innerHTML = `<span class="shop-confirmation-icon">✓</span><h3>Thanks, ${escapeHtml(customerName)}!</h3><p>Your order <strong>#${escapeHtml(result.orderId)}</strong> has been sent to the store.</p><span class="shop-confirmation-demo">Payment is due later. No online payment was taken.</span><button class="button button-secondary" type="button" data-shop-new-order>Continue shopping</button>`;
      $("#shop-confirmation").classList.remove("hidden");
      renderCustomerShop();
    } catch (checkoutError) {
      error.textContent = checkoutError.message;
      error.classList.remove("hidden");
      submitButton.disabled = false;
    }
    return;
  }

  const orderNumber = Math.max(1048, ...state.orders.map((order) => Number(order.id.replace(/\D/g, "")) || 0)) + 1;
  const orderId = `OR-${orderNumber}`;
  const orderItems = items.map(({ product, quantity }) => ({
    productId: product.id,
    name: product.name,
    quantity,
    unitPrice: product.price
  }));
  for (const { product, quantity } of items) product.stock -= quantity;
  state.orders.unshift({
    id: orderId,
    customer: form.elements.customer.value.trim(),
    phone: form.elements.phone.value.trim(),
    productId: orderItems[0].productId,
    quantity: orderItems.reduce((sum, item) => sum + item.quantity, 0),
    items: orderItems,
    fulfillment,
    deliveryAddress: fulfillment === "delivery" ? address : "",
    note: form.elements.note.value.trim(),
    amount: orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    status: "Pending",
    paymentStatus: "Unpaid",
    paymentMethod: "Pay later",
    createdAt: new Date().toISOString()
  });
  saveState();
  customerCart.clear();
  form.reset();
  $("#shop-fulfillment").value = "delivery";
  $("#shop-address-field").classList.remove("hidden");
  customerOrderForm.elements.address.required = true;
  $("#shop-order-error").classList.add("hidden");
  $("#customer-order-form").classList.add("hidden");
  $("#shop-confirmation").innerHTML = `<span class="shop-confirmation-icon">✓</span><h3>Thanks, ${escapeHtml(state.orders[0].customer)}!</h3><p>Your demo order <strong>#${escapeHtml(orderId)}</strong> has been recorded in this browser.</p><span class="shop-confirmation-demo">This is a preview only. The store won’t receive this order and no payment was taken.</span><button class="button button-secondary" type="button" data-shop-new-order>Continue shopping</button>`;
  $("#shop-confirmation").classList.remove("hidden");
  renderAll();
}

function openModal(id) {
  const modal = $(`#${id}`);
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  const firstInput = $("input, select", modal);
  if (firstInput) firstInput.focus();
}

function closeModals() {
  $$(".modal-backdrop").forEach((modal) => modal.classList.add("hidden"));
  document.body.style.overflow = "";
}

function updateOrderTotal() {
  const product = productFor($("#order-product").value);
  const quantity = Number($("#order-form").elements.quantity.value);
  $("#order-total").textContent = money(product ? product.price * quantity : 0);
  $("#submit-order").textContent = $("#payment-method").value === "stripe" ? "Continue to secure checkout" : "Create order";
}

function prepareOrderModal() {
  const select = $("#order-product");
  const available = state.products.filter((product) => product.stock > 0);
  select.innerHTML = available.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} — ${money(product.price)} (${product.stock} in stock)</option>`).join("");
  $("#order-error").classList.add("hidden");
  $("#order-error").textContent = "";
  $("#order-form").elements.quantity.value = 1;
  updateOrderTotal();
  if (!available.length) {
    showToast("Add in-stock products before creating an order.", true);
    return;
  }
  openModal("order-modal");
}

async function createOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const product = productFor(form.elements.product.value);
  const quantity = Number(form.elements.quantity.value);
  const error = $("#order-error");
  if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > product.stock) {
    error.textContent = product ? `Only ${product.stock} units are currently in stock.` : "Choose a product that is in stock.";
    error.classList.remove("hidden");
    return;
  }
  if (!demoMode) {
    const submitButton = $("#submit-order");
    submitButton.disabled = true;
    try {
      const payment = paymentOptions.find((option) => option.value === form.elements.paymentOption.value);
      if (!payment) throw new Error("Choose a valid payment option.");
      const order = await apiRequest("/api/admin/orders", {
        method: "POST",
        body: JSON.stringify({
          customer: form.elements.customer.value.trim(),
          phone: form.elements.phone.value.trim(),
          items: [{ productId: product.id, quantity }],
          paymentStatus: payment.status,
          paymentMethod: payment.method
        })
      });
      state.orders.unshift(order);
      const updatedProduct = productFor(product.id);
      if (updatedProduct) updatedProduct.stock = Math.max(0, updatedProduct.stock - quantity);
      renderAll();
      closeModals();
      form.reset();
      updateOrderTotal();
      showToast("Order saved to the shared store.");
    } catch (error) {
      $("#order-error").textContent = error.message;
      $("#order-error").classList.remove("hidden");
    } finally {
      submitButton.disabled = false;
    }
    return;
  }
  if (form.elements.paymentOption.value === "stripe") {
    startCardCheckout(form, product, quantity, error);
    return;
  }
  saveOrder(form, product, quantity, form.elements.paymentOption.value, form.elements.status.value);
  showToast(form.elements.paymentOption.value === "unpaid" ? "Order created. Payment is due later." : "Order created and payment recorded.");
}

function saveOrder(form, product, quantity, paymentOption, status, orderId) {
  const payment = paymentOptions.find((option) => option.value === paymentOption);
  if (!payment) throw new Error("Choose a valid payment option.");
  const orderNumber = Math.max(1048, ...state.orders.map((order) => Number(order.id.replace(/\D/g, "")) || 0)) + 1;
  product.stock = Math.max(0, product.stock - quantity);
  state.orders.unshift({
    id: orderId || `OR-${orderNumber}`,
    customer: form.elements.customer.value.trim(),
    phone: form.elements.phone.value.trim(),
    productId: product.id,
    quantity,
    amount: product.price * quantity,
    status,
    paymentStatus: payment.status,
    paymentMethod: payment.method,
    createdAt: new Date().toISOString()
  });
  saveState();
  renderAll();
  closeModals();
  form.reset();
  updateOrderTotal();
  return true;
}

async function startCardCheckout(form, product, quantity, error) {
  const submitButton = $("#submit-order");
  submitButton.disabled = true;
  error.classList.add("hidden");
  try {
    const response = await fetch("/api/checkout-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: `OR-${Math.max(1048, ...state.orders.map((order) => Number(order.id.replace(/\D/g, "")) || 0)) + 1}`,
        customer: form.elements.customer.value.trim(),
        phone: form.elements.phone.value.trim(),
        productId: product.id,
        quantity,
        status: form.elements.status.value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not start card checkout.");
    window.location.assign(result.checkoutUrl);
  } catch (checkoutError) {
    error.textContent = checkoutError.message || "Card checkout is unavailable. Try again or choose pay later.";
    error.classList.remove("hidden");
    submitButton.disabled = false;
  }
}

async function completeCardCheckout() {
  const params = new URLSearchParams(window.location.search);
  const checkoutSession = params.get("session_id");
  const paymentResult = params.get("payment");
  if (!checkoutSession || !paymentResult) {
    if (paymentResult) window.history.replaceState({}, "", window.location.pathname);
    return;
  }
  if (!demoMode) {
    try {
      const result = await apiRequest(`/api/checkout-sessions/${encodeURIComponent(checkoutSession)}?result=${encodeURIComponent(paymentResult)}`);
      window.history.replaceState({}, "", `${window.location.pathname}?shop`);
      if (paymentResult === "success" && result.paymentStatus === "Paid") {
        customerCart.clear();
        renderCustomerShop();
        $("#customer-order-form").classList.add("hidden");
        $("#shop-confirmation").innerHTML = `<span class="shop-confirmation-icon">✓</span><h3>Payment received</h3><p>Your order <strong>#${escapeHtml(result.orderId)}</strong> is confirmed. The store will contact you about fulfillment.</p>`;
        $("#shop-confirmation").classList.remove("hidden");
      } else {
        showToast("Payment was not completed. Your order was not placed.", true);
      }
    } catch (checkoutError) {
      console.error("Could not verify completed Stripe checkout:", checkoutError);
      window.history.replaceState({}, "", `${window.location.pathname}?shop`);
      showToast(checkoutError.message, true);
    }
    return;
  }
  if (paymentResult !== "success") {
    window.history.replaceState({}, "", window.location.pathname);
    showToast("Payment was cancelled. No order was placed.", true);
    return;
  }
  window.history.replaceState({}, "", window.location.pathname);
  try {
    const response = await fetch(`/api/checkout-sessions/${encodeURIComponent(checkoutSession)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Payment could not be verified.");
    const existing = state.orders.find((order) => order.id === result.order.id);
    if (!existing) {
      const product = productFor(result.order.productId);
      if (!product) throw new Error("Payment succeeded, but its product is missing from this catalog. Contact the store administrator.");
      const quantity = Number(result.order.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Payment succeeded, but the order quantity is invalid. Contact the store administrator.");
      const form = $("#order-form");
      form.elements.customer.value = result.order.customer;
      form.elements.phone.value = result.order.phone;
      const hadEnoughStock = quantity <= product.stock;
      saveOrder(form, product, quantity, "paid_other", result.order.status, result.order.id);
      const savedOrder = state.orders.find((order) => order.id === result.order.id);
      if (savedOrder) savedOrder.paymentMethod = "Visa/Mastercard via Stripe";
      saveState();
      renderAll();
      if (!hadEnoughStock) {
        showToast("Payment confirmed, but inventory needs review.", true);
        return;
      }
    }
    showToast(existing ? "This paid order was already recorded." : "Card payment confirmed. Order created.");
  } catch (checkoutError) {
    console.error("Could not verify completed Stripe checkout:", checkoutError);
    showToast(checkoutError.message || "Payment verification failed. Contact the store administrator.", true);
  }
}

async function addProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  const category = form.elements.category.value.trim();
  const price = Number(form.elements.price.value);
  const stock = Number(form.elements.stock.value);
  const error = $("#product-error");
  if (!name || !category || !Number.isInteger(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
    error.textContent = "Enter a product name and category, a whole-number price in UGX, and whole-number stock.";
    error.classList.remove("hidden");
    return;
  }
  if (!demoMode) {
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      const product = await apiRequest("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({ name, category, price, stock })
      });
      state.products.push(product);
      renderAll();
      closeModals();
      form.reset();
      showToast("Product added to the shared catalog.");
    } catch (requestError) {
      error.textContent = requestError.message;
      error.classList.remove("hidden");
    } finally {
      submitButton.disabled = false;
    }
    return;
  }
  const skuBase = name.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 3) || "NEW";
  state.products.push({ id: `p${Date.now()}`, name, category, sku: `${skuBase}-${String(state.products.length + 1).padStart(3, "0")}`, price, stock, icon: "◈" });
  saveState();
  renderAll();
  closeModals();
  form.reset();
  showToast("Product added to your catalog.");
}

async function setOrderPayment(orderId, paymentOption) {
  const order = state.orders.find((item) => item.id === orderId);
  const payment = paymentOptions.find((option) => option.value === paymentOption);
  if (!order || !payment) return;
  if (!demoMode) {
    try {
      await apiRequest(`/api/admin/orders/${encodeURIComponent(orderId)}/payment`, {
        method: "PATCH",
        body: JSON.stringify({ paymentOption })
      });
      order.paymentStatus = payment.status;
      order.paymentMethod = payment.method;
      renderAll();
      showToast(`Order ${order.id} payment marked ${payment.status.toLowerCase()}.`);
    } catch (error) {
      showToast(error.message, true);
      renderOrders();
    }
    return;
  }
  order.paymentStatus = payment.status;
  order.paymentMethod = payment.method;
  saveState();
  renderAll();
  showToast(`Order ${order.id} payment marked ${payment.status.toLowerCase()}.`);
}

async function setOrderStatus(orderId, status) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order || order.status === status) return;
  if (!demoMode) {
    try {
      await apiRequest(`/api/admin/orders/${encodeURIComponent(orderId)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      await refreshAdminState();
      showToast(`Order ${order.id} marked ${status.toLowerCase()}.`);
    } catch (error) {
      showToast(error.message, true);
      renderOrders();
    }
    return;
  }
  const items = orderItemsFor(order);
  if (order.status === "Cancelled" && status !== "Cancelled") {
    const unavailable = items.find((item) => {
      const product = productFor(item.productId);
      return product && product.stock < item.quantity;
    });
    if (unavailable) {
      const product = productFor(unavailable.productId);
      showToast(`Cannot reopen order: only ${product.stock} ${product.stock === 1 ? "unit is" : "units are"} in stock for ${product.name}.`, true);
      renderOrders();
      return;
    }
    for (const item of items) {
      const product = productFor(item.productId);
      if (product) product.stock -= item.quantity;
    }
  } else if (order.status !== "Cancelled" && status === "Cancelled") {
    for (const item of items) {
      const product = productFor(item.productId);
      if (product) product.stock += item.quantity;
    }
  }
  order.status = status;
  saveState();
  renderAll();
  showToast(`Order ${order.id} marked ${status.toLowerCase()}.`);
}

async function deleteOrder(orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order || !window.confirm(`Delete order ${order.id}? This cannot be undone.`)) return;
  if (!demoMode) {
    try {
      await apiRequest(`/api/admin/orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
      await refreshAdminState();
      showToast("Order deleted.");
    } catch (error) {
      showToast(error.message, true);
    }
    return;
  }
  if (order.status !== "Cancelled") {
    for (const item of orderItemsFor(order)) {
      const product = productFor(item.productId);
      if (product) product.stock += item.quantity;
    }
  }
  state.orders = state.orders.filter((item) => item.id !== orderId);
  saveState();
  renderAll();
  showToast("Order deleted.");
}

async function deleteProduct(productId) {
  const product = productFor(productId);
  if (!product) return;
  if (!demoMode) {
    if (!window.confirm(`Remove ${product.name} from the customer catalog?`)) return;
    try {
      await apiRequest(`/api/admin/products/${encodeURIComponent(productId)}`, { method: "DELETE" });
      state.products = state.products.filter((item) => item.id !== productId);
      renderAll();
      showToast("Product removed from the shared catalog.");
    } catch (error) {
      showToast(error.message, true);
    }
    return;
  }
  if (state.orders.some((order) => orderItemsFor(order).some((item) => item.productId === productId))) {
    showToast("This product has order history and can’t be deleted.", true);
    return;
  }
  if (!window.confirm(`Delete ${product.name} from your catalog?`)) return;
  state.products = state.products.filter((item) => item.id !== productId);
  saveState();
  renderAll();
  showToast("Product deleted.");
}

function exportOrders() {
  const rows = [["Order", "Customer", "Telephone", "Product", "Quantity", "Date", "Amount (UGX)", "Payment status", "Payment method", "Status"]];
  sortedOrders().forEach((order) => rows.push([
    order.id, order.customer, order.phone || "", orderItemsSummary(order),
    order.quantity, formatDate(order.createdAt), order.amount.toFixed(2), order.paymentStatus || "Unrecorded",
    order.paymentMethod || "", order.status
  ]));
  const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = `bravo-express-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Your orders report is ready.");
}

$$(".nav-item").forEach((item) => item.addEventListener("click", () => navigate(item.dataset.view)));
$$("[data-navigate]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.navigate)));
$$("[data-open-order]").forEach((button) => button.addEventListener("click", prepareOrderModal));
$$("[data-open-product]").forEach((button) => button.addEventListener("click", () => {
  const productError = $("#product-error");
  if (productError) {
    productError.classList.add("hidden");
    productError.textContent = "";
  }
  openModal("product-modal");
}));
$$("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModals));
$$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => {
  if (event.target === backdrop) closeModals();
}));

const orderForm = $("#order-form");
const productForm = $("#product-form");
const orderProduct = $("#order-product");
const paymentMethod = $("#payment-method");
const chartRange = $("#chart-range");
const ordersSearch = $("#orders-search");
const statusFilter = $("#status-filter");
const paymentFilter = $("#payment-filter");
const productsSearch = $("#products-search");
const stockFilter = $("#stock-filter");
const customersSearch = $("#customers-search");
const allOrders = $("#all-orders");
const exportButton = $("#export-button");
const ordersExport = $("#orders-export");
const mobileMenu = $("#mobile-menu");
const helpButton = $("#help-button");
const globalSearch = $("#global-search");
const todayLabel = $("#today-label");
const paymentNote = $("#payment-note");
const customerOrderForm = $("#customer-order-form");
const shopFulfillment = $("#shop-fulfillment");
const loginForm = $("#login-form");
const logoutButton = $("#logout-button");

if (orderForm) orderForm.addEventListener("submit", createOrder);
if (customerOrderForm) customerOrderForm.addEventListener("submit", submitCustomerOrder);
if (shopFulfillment) shopFulfillment.addEventListener("change", () => {
  const isDelivery = shopFulfillment.value === "delivery";
  $("#shop-address-field").classList.toggle("hidden", !isDelivery);
  customerOrderForm.elements.address.required = isDelivery;
});
if (productForm) productForm.addEventListener("submit", addProduct);
if (orderProduct) orderProduct.addEventListener("change", updateOrderTotal);
if (orderForm && orderForm.elements && orderForm.elements.quantity) orderForm.elements.quantity.addEventListener("input", updateOrderTotal);
if (paymentMethod) paymentMethod.addEventListener("change", updateOrderTotal);
if (chartRange) chartRange.addEventListener("change", renderChart);
if (ordersSearch) ordersSearch.addEventListener("input", renderOrders);
if (statusFilter) statusFilter.addEventListener("change", renderOrders);
if (paymentFilter) paymentFilter.addEventListener("change", renderOrders);
if (productsSearch) productsSearch.addEventListener("input", renderProducts);
if (stockFilter) stockFilter.addEventListener("change", renderProducts);
if (customersSearch) customersSearch.addEventListener("input", renderCustomers);
if (allOrders) allOrders.addEventListener("change", (event) => {
  if (event.target.matches("[data-order-status]")) setOrderStatus(event.target.dataset.orderStatus, event.target.value);
  if (event.target.matches("[data-order-payment]")) setOrderPayment(event.target.dataset.orderPayment, event.target.value);
});
if (typeof document !== "undefined") {
  document.addEventListener("click", (event) => {
    const deleteOrderButton = event.target.closest("[data-delete-order]");
    const deleteProductButton = event.target.closest("[data-delete-product]");
    const addToBagButton = event.target.closest("[data-shop-add]");
    const changeQuantityButton = event.target.closest("[data-shop-quantity]");
    const removeFromBagButton = event.target.closest("[data-shop-remove]");
    const newShopOrderButton = event.target.closest("[data-shop-new-order]");
    if (deleteOrderButton) deleteOrder(deleteOrderButton.dataset.deleteOrder);
    if (deleteProductButton) deleteProduct(deleteProductButton.dataset.deleteProduct);
    if (addToBagButton) updateShopCart(addToBagButton.dataset.shopAdd, 1);
    if (changeQuantityButton) updateShopCart(changeQuantityButton.dataset.shopQuantity, Number(changeQuantityButton.dataset.step));
    if (removeFromBagButton) updateShopCart(removeFromBagButton.dataset.shopRemove, -(customerCart.get(removeFromBagButton.dataset.shopRemove) || 0));
    if (newShopOrderButton) {
      $("#shop-confirmation").classList.add("hidden");
      $("#customer-order-form").classList.remove("hidden");
    }
  });
}
if (loginForm) loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const error = $("#login-error");
  error.classList.add("hidden");
  submitButton.disabled = true;
  try {
    await apiRequest("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: form.elements.username.value.trim(),
        password: form.elements.password.value
      })
    });
    const saved = await apiRequest("/api/admin/state");
    state.products = saved.products;
    state.orders = saved.orders;
    document.body.classList.add("authenticated");
    $("#login-screen").classList.add("hidden");
    form.reset();
    renderAll();
  } catch (loginError) {
    error.textContent = loginError.message;
    error.classList.remove("hidden");
  } finally {
    submitButton.disabled = false;
  }
});
if (logoutButton) logoutButton.addEventListener("click", async () => {
  try {
    await apiRequest("/api/logout", { method: "POST" });
  } catch (error) {
    showToast(error.message, true);
    return;
  }
  state.products = [];
  state.orders = [];
  document.body.classList.remove("authenticated");
  $("#login-screen").classList.remove("hidden");
  renderAll();
});
if (exportButton) exportButton.addEventListener("click", exportOrders);
if (ordersExport) ordersExport.addEventListener("click", exportOrders);
if (mobileMenu) mobileMenu.addEventListener("click", () => {
  const sidebar = $("#sidebar");
  if (sidebar) sidebar.classList.toggle("open");
});
if (helpButton) helpButton.addEventListener("click", () => showToast("Help center coming soon."));
if (globalSearch) globalSearch.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const value = event.currentTarget.value.trim();
    if (!value) return;
    navigate("orders");
    const ordersSearchEl = $("#orders-search");
    if (ordersSearchEl) ordersSearchEl.value = value;
    renderOrders();
  }
});
if (typeof document !== "undefined") {
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModals();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      const searchInput = $("#global-search");
      if (searchInput) searchInput.focus();
    }
  });
}

if (todayLabel) todayLabel.textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase();
const stripeOption = $('#payment-method option[value="stripe"]');
if (stripeOption) stripeOption.remove();
if (paymentNote) paymentNote.textContent = "Cash, card, and transfer options record payments already collected. To charge Visa or Mastercard online, customers use the secure customer shop.";

async function initializeApp() {
  const isShop = new URLSearchParams(window.location.search).has("shop");
  if (demoMode) {
    if (isShop) {
      document.body.classList.add("shop-mode");
      $("#shop-notice").innerHTML = "<strong>Storefront preview</strong><span>Demo only: orders stay in this browser. No real payment is collected.</span>";
    }
    document.body.classList.remove("booting");
    renderAll();
    if (isShop) navigate("shop");
    completeCardCheckout();
    return;
  }

  document.body.classList.add("online-mode");
  if (isShop) {
    document.body.classList.add("shop-mode");
    document.body.classList.remove("booting");
    navigate("shop");
    $("#shop-notice").innerHTML = "<strong>Online storefront</strong><span>Loading the store catalog and checkout options…</span>";
    $("#shop-checkout-note").textContent = "Loading secure checkout options…";
    $("#shop-submit").textContent = "Continue to secure card payment";
    try {
      const [health, saved] = await Promise.all([
        apiRequest("/api/health"),
        apiRequest("/api/products")
      ]);
      onlineOrdersAvailable = health.configured;
      onlinePaymentsAvailable = health.payments;
      state.products = saved;
      state.orders = [];
      renderCustomerShop();
      if (onlinePaymentsAvailable) {
        $("#shop-notice").innerHTML = "<strong>Secure online shop</strong><span>Your order is sent to the store. Card payment is processed securely by Stripe.</span>";
        $("#shop-checkout-note").textContent = "Visa and Mastercard checkout is handled securely by Stripe. Card details are never stored by this store.";
        $("#shop-footer-note").textContent = "Secure card checkout · pickup & delivery";
      } else if (onlineOrdersAvailable) {
        $("#shop-notice").innerHTML = "<strong>Online orders are open</strong><span>Your order is sent to the store. You can pay when your order is collected or delivered.</span>";
        $("#shop-checkout-note").textContent = "Place your order now and pay later. No online payment will be taken.";
        $("#shop-submit").textContent = "Place order — pay later";
        $("#shop-footer-note").textContent = "Orders sent to store · pay later";
      } else {
        $("#shop-notice").innerHTML = "<strong>Online shop setup in progress</strong><span>Browse products now; secure card checkout will be available soon.</span>";
        $("#shop-checkout-note").textContent = "Online card checkout is not enabled yet. Please check back soon.";
        $("#shop-submit").textContent = "Online checkout unavailable";
        $("#shop-submit").disabled = true;
        $("#shop-footer-note").textContent = "Online payments are being set up";
      }
      await completeCardCheckout();
    } catch (error) {
      state.products = [];
      renderCustomerShop();
      $("#shop-notice").innerHTML = "<strong>Online shop setup in progress</strong><span>The store catalog is not available yet. Please check back soon.</span>";
      $("#shop-checkout-note").textContent = "Secure checkout will be available when the store is ready.";
      $("#shop-submit").textContent = "Online checkout unavailable";
      $("#shop-footer-note").textContent = "Online store setup in progress";
      $("#shop-product-grid").innerHTML = `<div class="shop-empty-products">${escapeHtml(error.message)} Please try again later.</div>`;
      $("#shop-submit").disabled = true;
    }
    return;
  }

  const loginScreen = $("#login-screen");
  const loginError = $("#login-error");
  try {
    const health = await apiRequest("/api/health");
    if (!health.configured) {
      loginError.textContent = "The secure store server is not fully configured yet.";
      loginError.classList.remove("hidden");
      loginScreen.classList.remove("hidden");
      document.body.classList.remove("booting");
      return;
    }
    const session = await apiRequest("/api/session");
    if (!session.authenticated) {
      loginScreen.classList.remove("hidden");
      document.body.classList.remove("booting");
      return;
    }
    await refreshAdminState();
    document.body.classList.add("authenticated");
    document.body.classList.remove("booting");
    completeCardCheckout();
  } catch (error) {
    loginError.textContent = error.message;
    loginError.classList.remove("hidden");
    loginScreen.classList.remove("hidden");
    document.body.classList.remove("booting");
  }
}

initializeApp();
