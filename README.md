# Bravo Express sales and orders

## Connected online store

The connected version serves both the customer shop and the private staff dashboard from the same Render service. Customer orders and stock are shared through Supabase. Card checkout is handled by Stripe; the server verifies payment before marking an order paid. Never put provider keys in browser code, GitHub, or this README.

### Set up Supabase

1. Create a Supabase project.
2. Open **SQL Editor**, run [`supabase/schema.sql`](./supabase/schema.sql), and wait for it to finish. This creates the tables and order/stock functions and seeds sample products.
3. In **Project Settings → API**, copy the project URL and the `service_role` secret. The service-role secret bypasses database row-level security, so only enter it as a Render secret.

### Deploy on Render

1. Connect the GitHub repository to Render and create a Blueprint from [`render.yaml`](./render.yaml).
2. In the Render service's environment settings, enter `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USERNAME`, and a strong unique `ADMIN_PASSWORD`. Render generates `SESSION_SECRET`.
3. Deploy the service and open its `https://…onrender.com` address once. Render provides that address to the app automatically.

### Enable card payments

1. In Stripe, use **test mode** first and check that your account can accept the intended UGX payments.
2. Create a webhook endpoint at `https://YOUR-RENDER-ADDRESS/api/stripe-webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.expired`.
3. Add the Stripe test secret key as `STRIPE_SECRET_KEY` and the endpoint's signing secret as `STRIPE_WEBHOOK_SECRET` in Render. Redeploy after saving.
4. Test customer checkout, webhook confirmation, cancellation, and stock restoration before switching to live keys. Stripe fees and account eligibility depend on your country and account.

The dashboard is private behind the configured staff login. Share the Render URL with customers using `?shop` (for example, `https://YOUR-RENDER-ADDRESS/?shop`). The GitHub Pages site remains a browser-local demo; it does not share orders with this service. A Render free service may sleep when idle and take a short time to wake.

Amounts are displayed as whole UGX values. Stripe's legacy UGX amount format requires two decimal places, so checkout sends the displayed price multiplied by 100.

## Browser-only demo

The GitHub Pages workflow also serves a free demo. Open the public Pages URL with `?shop` to preview the customer storefront. Demo orders are saved only in that browser; they are not sent to staff and no payment is taken. Do not enter real customer information.

Opening `index.html` directly runs the same local-only demo. For the connected service locally, install Node.js 18 or newer and run `npm start`; configure the required environment variables as described above.
