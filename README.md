# Bravo Express sales and orders

## Free online demo

This project includes a GitHub Pages deployment workflow. To publish it at no hosting cost:

1. Create a **public** GitHub repository and upload the project files, including `.github/workflows/pages.yml`, to its `main` branch. A public repository means the app's source code is visible to everyone.
2. In the repository, open **Settings → Pages**, select **GitHub Actions** as the build and deployment source, and save.
3. Open **Actions** and wait for **Deploy free demo to GitHub Pages** to finish. GitHub will show the website URL in the deployment details and **Settings → Pages**.

The free demo supports adding catalog items with whole-shilling UGX price tags, managing inventory, creating orders, and recording cash, Visa, Mastercard, bank-transfer, or other payments already collected. These payment selections do **not** charge a card. Online card checkout is disabled on the hosted demo.

The customer storefront preview is available at `https://okejujohngabriel-prog.github.io/gabriel/?shop` (or use **Preview customer shop** in the dashboard). Customers can build a multi-item bag, choose pickup or delivery, and place a demo pay-later order. Demo orders are saved only in the submitting browser; they are not sent to the business or shared with staff. The public demo does not have a private staff area, shared database, or live payment processing. Do not enter real customer information.

Amounts in the app and optional local Stripe development checkout are in UGX. Existing price values are unchanged. Stripe requires UGX amounts to be sent in its legacy two-decimal representation, so checkout multiplies the displayed whole-shilling price by 100.

Products and orders are saved only in each visitor's browser. The demo has no shared order database or private admin area; visitors will not see each other's orders. To accept actual card payments or share orders between devices, you'll need a separately hosted server/database and payment processing, which may involve fees.

## Run free on your computer

Open `index.html` in a browser. Data stays in that browser on your computer.

## Optional Stripe development server

For local Stripe Checkout testing, install Node.js 18 or newer, set `STRIPE_SECRET_KEY` in the server environment to a Stripe **test** secret key, run `npm start`, and open `http://localhost:3000`. Never put the secret key in browser code. Stripe charges processing fees for real transactions. The sample products support checkout; products added in the browser need trusted prices added to `server.mjs`.
