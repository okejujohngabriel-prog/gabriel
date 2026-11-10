# Bravo Express sales and orders

## Temporary free online demo

The Render Blueprint in [`render.yaml`](./render.yaml) uses the existing free web service in Oregon and creates a free PostgreSQL database in the same region. Both the customer storefront and staff dashboard use the same database, so demo orders are visible to staff. Render does not currently offer an Africa region, so expect higher latency from Uganda.

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

The existing GitHub Pages site remains a browser-local demo and does not share orders with staff.
