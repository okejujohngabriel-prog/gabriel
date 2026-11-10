# Bravo Express sales and orders

## Temporary free online demo

The Render Blueprint in [`render.yaml`](./render.yaml) creates a free web service and PostgreSQL database in Singapore. Both the customer storefront and staff dashboard use the same database, so demo orders are visible to staff.

**This is for testing only, not real customer orders.** Render's free web service can sleep after inactivity, and its free PostgreSQL database expires 30 days after creation. Data can be lost when the database expires. Upgrade to paid hosting and arrange a database backup before relying on the app for business.

The Blueprint generates a staff password and session secret. After deployment, find the staff password in the `ADMIN_PASSWORD` environment variable on the Render service. Sign in with username `staff`. Keep the password private and change it before using any production hosting.

The app applies [`database/schema.sql`](./database/schema.sql) when the Render service starts. Card payments are not enabled unless Stripe secrets are configured.

## Local development

Install Node.js 18 or newer, set `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and a `SESSION_SECRET` of at least 32 characters, then run:

```sh
npm install
npm run db:init
npm start
```

The existing GitHub Pages site remains a browser-local demo and does not share orders with staff.# Bravo Express sales and orders

## Africa-region deployment

The connected app is designed to run on Google Cloud Run with PostgreSQL on Cloud SQL in `africa-south1` (Johannesburg). Customer orders, stock reservations, and the staff dashboard use the same PostgreSQL database. The Node service connects through Cloud Run's Cloud SQL Unix socket. Stripe handles card checkout when its secrets are configured.

**Cloud SQL is a paid service and requires an active Google Cloud billing account.** Review the current [Cloud SQL pricing](https://cloud.google.com/sql/pricing) and [Cloud Run pricing](https://cloud.google.com/run/pricing) before provisioning. Set a budget alert, keep Cloud Run minimum instances at zero, and cap maximum instances to control costs. No Google Cloud resources are created by this repository.

### Create the database

1. In Google Cloud Console, select a project with billing enabled. Enable Cloud SQL Admin, Cloud Run, Cloud Build, Artifact Registry, and Secret Manager APIs.
2. Create a PostgreSQL Cloud SQL instance in `africa-south1`. Create a database named `bravo_express` and a dedicated database user. Save the instance connection name (`PROJECT_ID:africa-south1:INSTANCE_NAME`) and database username.
3. Use Cloud SQL Studio to run [`database/schema.sql`](./database/schema.sql) against `bravo_express`. This creates the tables and seeds sample products. The former Supabase schema is not used by this deployment.
4. Store the database password, staff password, and a random `SESSION_SECRET` of at least 32 characters in Secret Manager. Never put secrets in source code, GitHub, or this README.
5. Grant the Cloud Run runtime service account the **Cloud SQL Client** role and **Secret Manager Secret Accessor** access to only the secrets it needs.

### Deploy the app

Deploy this repository's source as a Cloud Run service named `bravo-express` in `africa-south1`. Allow unauthenticated invocations so customers can use the storefront; staff routes require the app's sign-in session. Attach the Cloud SQL instance and set the service's maximum instances to 3 (the server uses up to 5 database connections per instance).

Set these Cloud Run environment variables:

| Variable | Value |
| --- | --- |
| `INSTANCE_CONNECTION_NAME` | The Cloud SQL connection name from the instance details |
| `DB_USER` | The dedicated Cloud SQL database username |
| `DB_NAME` | `bravo_express` |
| `ADMIN_USERNAME` | The staff sign-in username |

Map Secret Manager versions to these environment variables: `DB_PASSWORD`, `ADMIN_PASSWORD`, and `SESSION_SECRET`. The app needs the service URL as `APP_URL` for same-origin checks and Stripe return links. After the first deployment, copy the Cloud Run service URL (for example, `https://bravo-express-....run.app`) into `APP_URL` and deploy a new revision.

The health endpoint is `https://YOUR-SERVICE-URL/api/health`. It reports `configured: true` when the database connection settings, staff login secrets, and `APP_URL` are present; `payments` remains false until Stripe is configured.

### Enable card payments

1. Confirm with Stripe that your account can accept the intended UGX payments. Start in test mode.
2. Create Secret Manager secrets for `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, then map them to Cloud Run environment variables with the same names.
3. Register `https://YOUR-SERVICE-URL/api/stripe-webhook` in Stripe for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.expired`.
4. Test customer checkout, webhook confirmation, cancellation, and stock restoration before using live keys. Stripe fees and account eligibility depend on your country and account.

Amounts are displayed as whole UGX values. Stripe's legacy UGX amount format requires two decimal places, so checkout sends the displayed price multiplied by 100.

## Current hosted demo

The existing GitHub Pages site remains a browser-local demo. Its orders stay in that browser; they are not sent to staff and no payment is taken. Do not enter real customer information. The previously created Render service is not connected to the Cloud SQL database and must not be treated as the live ordering system.

Opening `index.html` directly runs the same local-only demo. For local server development, install Node.js 18 or newer, set the PostgreSQL connection variables and staff credentials, then run `npm install` and `npm start`.
