const STORAGE_KEY = "orbit-sales-orders-v1";

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
    { id: "OR-1048", customer: "Olivia Rhye", email: "olivia@example.com", productId: "p3", quantity: 1, amount: 36, status: "Delivered", createdAt: daysAgo(0) },
    { id: "OR-1047", customer: "Phoenix Baker", email: "phoenix@example.com", productId: "p1", quantity: 2, amount: 96, status: "Processing", createdAt: daysAgo(0) },
    { id: "OR-1046", customer: "Lana Steiner", email: "lana@example.com", productId: "p5", quantity: 1, amount: 32, status: "Shipped", createdAt: daysAgo(1) },
    { id: "OR-1045", customer: "Demi Wilkinson", email: "demi@example.com", productId: "p2", quantity: 1, amount: 72, status: "Pending", createdAt: daysAgo(2) },
    { id: "OR-1044", customer: "Candice Wu", email: "candice@example.com", productId: "p3", quantity: 2, amount: 72, status: "Delivered", createdAt: daysAgo(3) },
    { id: "OR-1043", customer: "Natali Craig", email: "natali@example.com", productId: "p4", quantity: 1, amount: 24, status: "Delivered", createdAt: daysAgo(4) },
    { id: "OR-1042", customer: "Drew Cano", email: "drew@example.com", productId: "p5", quantity: 2, amount: 64, status: "Processing", createdAt: daysAgo(6) },
    { id: "OR-1041", customer: "Orlando Diggs", email: "orlando@example.com", productId: "p3", quantity: 1, amount: 36, status: "Delivered", createdAt: daysAgo(8) },
    { id: "OR-1040", customer: "Andi Lane", email: "andi@example.com", productId: "p1", quantity: 1, amount: 48, status: "Delivered", createdAt: daysAgo(12) },
    { id: "OR-1039", customer: "Kate Morrison", email: "kate@example.com", productId: "p5", quantity: 1, amount: 32, status: "Cancelled", createdAt: daysAgo(18) }
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
let toastTimer;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = (amount) => new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", currencyDisplay: "code", maximumFractionDigits: 0 }).format(amount || 0);
const formatDate = (value) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
const shortDate = (value) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const initials = (name) => name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
const sortedOrders = () => [...state.orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
const productFor = (id) => state.products.find((product) => product.id === id);
const isRecognizedSale = (order) => order.status !== "Cancelled" && order.paymentStatus !== "Unpaid";
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

function customerMarkup(name, index = 0) {
  return `<div class="customer-cell"><span class="customer-initial tone-${index % 4}">${escapeHtml(initials(name))}</span><span class="customer-name">${escapeHtml(name)}</span></div>`;
}

function renderOrderRows(orders, target) {
  target.innerHTML = orders.map((order, index) => `
    <tr>
      <td class="order-id">#${escapeHtml(order.id)}</td>
      <td>${customerMarkup(order.customer, index)}</td>
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
    const matchesQuery = `${order.id} ${order.customer} ${order.email}`.toLowerCase().includes(query);
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
    const key = order.email.toLowerCase();
    const customer = customerMap.get(key) || { name: order.customer, email: order.email, orders: 0, spent: 0, lastOrder: order.createdAt };
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
  const customers = allCustomers.filter((customer) => `${customer.name} ${customer.email}`.toLowerCase().includes(query));
  const returning = allCustomers.filter((customer) => customer.orders > 1).length;
  const totalSpend = allCustomers.reduce((sum, customer) => sum + customer.spent, 0);
  customersCount.textContent = String(allCustomers.length);
  returningCount.textContent = String(returning);
  customerSpend.textContent = money(allCustomers.length ? totalSpend / allCustomers.length : 0);
  customerListCount.textContent = `${customers.length} ${customers.length === 1 ? "customer" : "customers"}`;
  customersTable.innerHTML = customers.map((customer, index) => `<tr><td>${customerMarkup(customer.name, index)}</td><td>${escapeHtml(customer.email)}</td><td>${customer.orders}</td><td>${money(customer.spent)}</td><td>${formatDate(customer.lastOrder)}</td></tr>`).join("");
  customersEmpty.classList.toggle("hidden", customers.length > 0);
}

function renderAll() {
  renderDashboard();
  renderOrders();
  renderProducts();
  renderCustomers();
}

function navigate(view) {
  activeView = view;
  $$(".view-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `view-${view}`));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  const label = { dashboard: "Overview", orders: "Orders", products: "Products", customers: "Customers" }[view];
  $("#breadcrumb-current").textContent = label;
  $("#sidebar").classList.remove("open");
  if (view === "orders") renderOrders();
  if (view === "products") renderProducts();
  if (view === "customers") renderCustomers();
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

function createOrder(event) {
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
    email: form.elements.email.value.trim(),
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
        email: form.elements.email.value.trim(),
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
  if (!checkoutSession || paymentResult !== "success") {
    if (paymentResult === "cancelled") showToast("Payment was cancelled. No order was placed.", true);
    if (paymentResult) window.history.replaceState({}, "", window.location.pathname);
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
      form.elements.email.value = result.order.email;
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

function addProduct(event) {
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
  const skuBase = name.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 3) || "NEW";
  state.products.push({ id: `p${Date.now()}`, name, category, sku: `${skuBase}-${String(state.products.length + 1).padStart(3, "0")}`, price, stock, icon: "◈" });
  saveState();
  renderAll();
  closeModals();
  form.reset();
  showToast("Product added to your catalog.");
}

function setOrderPayment(orderId, paymentOption) {
  const order = state.orders.find((item) => item.id === orderId);
  const payment = paymentOptions.find((option) => option.value === paymentOption);
  if (!order || !payment) return;
  order.paymentStatus = payment.status;
  order.paymentMethod = payment.method;
  saveState();
  renderAll();
  showToast(`Order ${order.id} payment marked ${payment.status.toLowerCase()}.`);
}

function setOrderStatus(orderId, status) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order || order.status === status) return;
  const product = productFor(order.productId);
  if (product && order.status === "Cancelled" && status !== "Cancelled") {
    if (product.stock < order.quantity) {
      showToast(`Cannot reopen order: only ${product.stock} units are in stock.`, true);
      renderOrders();
      return;
    }
    product.stock -= order.quantity;
  } else if (product && order.status !== "Cancelled" && status === "Cancelled") {
    product.stock += order.quantity;
  }
  order.status = status;
  saveState();
  renderAll();
  showToast(`Order ${order.id} marked ${status.toLowerCase()}.`);
}

function deleteOrder(orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order || !window.confirm(`Delete order ${order.id}? This cannot be undone.`)) return;
  if (order.status !== "Cancelled") {
    const product = productFor(order.productId);
    if (product) product.stock += order.quantity;
  }
  state.orders = state.orders.filter((item) => item.id !== orderId);
  saveState();
  renderAll();
  showToast("Order deleted.");
}

function deleteProduct(productId) {
  const product = productFor(productId);
  if (!product) return;
  if (state.orders.some((order) => order.productId === productId)) {
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
  const rows = [["Order", "Customer", "Email", "Product", "Quantity", "Date", "Amount (UGX)", "Payment status", "Payment method", "Status"]];
  sortedOrders().forEach((order) => rows.push([
    order.id, order.customer, order.email, productFor(order.productId)?.name || "Product removed",
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

if (orderForm) orderForm.addEventListener("submit", createOrder);
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
    if (deleteOrderButton) deleteOrder(deleteOrderButton.dataset.deleteOrder);
    if (deleteProductButton) deleteProduct(deleteProductButton.dataset.deleteProduct);
  });
}
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
if (typeof location !== "undefined" && (location.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(location.hostname))) {
  const stripeOption = $('#payment-method option[value="stripe"]');
  if (stripeOption) stripeOption.remove();
  if (paymentNote) paymentNote.textContent = "Cash, Visa, Mastercard, and transfer options record payments collected elsewhere; they do not charge a card. Online card checkout is unavailable in this free hosted demo.";
}
if (typeof document !== "undefined") {
  renderAll();
  completeCardCheckout();
  

}
