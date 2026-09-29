/**
 * Karthika Shopify App — Render Web Service
 *
 * Minimal Express server that:
 *   • Binds to process.env.PORT (required by Render)
 *   • Serves a health-check at GET /
 *   • Handles the Shopify App Proxy at /apps/karthika/*
 *   • Stubs OAuth routes so the app can be installed
 *
 * This is intentionally lightweight — the storefront logic lives
 * in the Shopify theme (assets/, sections/, snippets/).
 */

'use strict';

const express = require('express');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check (Render pings this to confirm the service is up) ─────────────
app.get('/', (_req, res) => {
  res.json({ status: 'ok', app: 'karthika-shopify-app', ts: new Date().toISOString() });
});

// ── Shopify App Proxy (/apps/karthika/*) ──────────────────────────────────────
// Shopify forwards requests here with an HMAC signature in the query string.
// We verify the signature, then return JSON the storefront Liquid can consume.
app.get('/apps/karthika', verifyAppProxy, (req, res) => {
  // Placeholder response — extend this with real logic as needed.
  res.json({ ok: true, message: 'Karthika app proxy is live.' });
});

app.get('/apps/karthika/recommend', verifyAppProxy, (req, res) => {
  // Legacy AI recommend endpoint — returns empty so the local assistant
  // (karthika-local-assistant.js) handles it client-side instead.
  res.json({ products: [] });
});

// ── OAuth install / callback ──────────────────────────────────────────────────
app.get('/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shop || !isValidShopDomain(shop)) {
    return res.status(400).send('Missing or invalid shop parameter.');
  }

  const apiKey    = process.env.SHOPIFY_API_KEY || '';
  const scopes    = process.env.SHOPIFY_SCOPES  || 'read_products';
  const redirectUri = `https://karthika-app.onrender.com/auth/callback`;
  const nonce     = crypto.randomBytes(16).toString('hex');

  const authUrl = `https://${shop}/admin/oauth/authorize`
    + `?client_id=${apiKey}`
    + `&scope=${scopes}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + `&state=${nonce}`;

  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { shop, code, hmac, state } = req.query;

  if (!shop || !code || !hmac) {
    return res.status(400).send('Missing required OAuth parameters.');
  }

  // Verify HMAC
  const params   = Object.assign({}, req.query);
  delete params.hmac;
  const message  = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  const digest   = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET || '')
    .update(message)
    .digest('hex');

  if (digest !== hmac) {
    return res.status(403).send('HMAC validation failed.');
  }

  // Exchange code for access token
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('No access_token in response');

    // TODO: persist tokenData.access_token for this shop in a database.
    // For now, redirect back to the Shopify admin.
    res.redirect(`https://${shop}/admin/apps`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('OAuth error — check server logs.');
  }
});

// ── Webhooks ──────────────────────────────────────────────────────────────────
app.post('/webhooks/app/uninstalled', express.raw({ type: 'application/json' }), (req, res) => {
  // Verify and handle app/uninstalled webhook
  res.sendStatus(200);
});

app.post('/webhooks/app/scopes_update', express.raw({ type: 'application/json' }), (req, res) => {
  res.sendStatus(200);
});

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Karthika app server running on port ${PORT}`);
});

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * Middleware: verify Shopify App Proxy HMAC signature.
 * https://shopify.dev/docs/apps/build/online-store/app-proxies#validate-proxy-requests
 */
function verifyAppProxy(req, res, next) {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return next(); // Skip verification if secret not configured yet

  const { signature, ...rest } = req.query;
  const message = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join('');
  const digest  = crypto.createHmac('sha256', secret).update(message).digest('hex');

  if (digest !== signature) {
    return res.status(403).json({ error: 'Invalid proxy signature' });
  }
  next();
}

/**
 * Validate that a shop domain looks like *.myshopify.com
 */
function isValidShopDomain(shop) {
  return /^[a-z0-9-]+\.myshopify\.com$/i.test(shop);
}
