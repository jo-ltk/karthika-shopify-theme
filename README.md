# Karthika Shopify theme

Online storefront theme for Karthika supermarket (Singapore). Built on Dawn with a custom grocery storefront layer.

## Local development

```bash
npm install
npm run theme:dev
```

Other scripts:

- `npm run theme:check` — Theme Check
- `npm run theme:push` — push to the development store
- `npm run theme:pull` — pull from the development store

Store environments are defined in `shopify.theme.toml`.

## Architecture notes

- **Cart:** Shopify Cart API is the source of truth (`assets/karthika-grocery.js` `CartManager` plus Dawn `cart.js` / cart drawer).
- **Search:** Shopify search + predictive search; recent queries stored in `localStorage`.
- **Wishlist:** product handles in `localStorage`; product data loaded from Shopify.
- **Checkout / account:** Shopify checkout and customer accounts only.
- **Assistant:** manual collection/recipe mode by default. Optional AI uses an App Proxy and is off unless enabled in the theme editor.
- **Delivery:** Singapore geography via theme settings.

Do not commit `.env` files. Theme Check should be run before production pushes.
