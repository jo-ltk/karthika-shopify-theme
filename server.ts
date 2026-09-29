/**
 * Karthika Shopify App — Render Web Service (TypeScript entry point)
 *
 * Render is configured to run `npx tsx server.ts`.
 * This file simply re-exports the server from server.js so both
 * `node server.js` and `npx tsx server.ts` work identically.
 *
 * All actual server logic lives in server.js.
 */

import express from 'express';
import crypto from 'crypto';

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({ status: 'ok', app: 'karthika-shopify-app', ts: new Date().toISOString() });
});

// ── Shopify App Proxy (/apps/karthika/*) ──────────────────────────────────────
app.get('/apps/karthika', verifyAppProxy, (_req, res) => {
  res.json({ ok: true, message: 'Karthika app proxy is live.' });
});

app.get('/apps/karthika/recommend', verifyAppProxy, (_req, res) => {
  // Legacy endpoint — local assistant handles recommendations client-side
  res.json({ products: [] });
});

// ── OAuth install / callback ──────────────────────────────────────────────────
app.get('/auth', (req, res) => {
  const shop = req.query.shop as string;
  if (!shop || !isValidShopDomain(shop)) {
    return res.status(400).send('Missing or invalid shop parameter.');
  }

  const apiKey      = process.env.SHOPIFY_API_KEY || '';
  const scopes      = process.env.SHOPIFY_SCOPES  || 'read_products';
  const redirectUri = 'https://karthika-app.onrender.com/auth/callback';
  const nonce       = crypto.randomBytes(16).toString('hex');

  const authUrl = `https://${shop}/admin/oauth/authorize`
    + `?client_id=${apiKey}`
    + `&scope=${scopes}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + `&state=${nonce}`;

  return res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { shop, code, hmac } = req.query as Record<string, string>;

  if (!shop || !code || !hmac) {
    return res.status(400).send('Missing required OAuth parameters.');
  }

  // Verify HMAC
  const params: Record<string, string> = { ...req.query as Record<string, string> };
  delete params.hmac;
  const message = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  const digest  = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET || '')
    .update(message)
    .digest('hex');

  if (digest !== hmac) {
    return res.status(403).send('HMAC validation failed.');
  }

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

    const tokenData = await tokenRes.json() as { access_token?: string };
    if (!tokenData.access_token) throw new Error('No access_token in response');

    return res.redirect(`https://${shop}/admin/apps`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    return res.status(500).send('OAuth error — check server logs.');
  }
});

// ── Webhooks ──────────────────────────────────────────────────────────────────
app.post('/webhooks/app/uninstalled', express.raw({ type: 'application/json' }), (_req, res) => {
  res.sendStatus(200);
});

app.post('/webhooks/app/scopes_update', express.raw({ type: 'application/json' }), (_req, res) => {
  res.sendStatus(200);
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Karthika app server running on port ${PORT}`);
});

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function verifyAppProxy(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) { next(); return; }

  const { signature, ...rest } = req.query as Record<string, string>;
  const message = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join('');
  const digest  = crypto.createHmac('sha256', secret).update(message).digest('hex');

  if (digest !== signature) {
    res.status(403).json({ error: 'Invalid proxy signature' });
    return;
  }
  next();
}

function isValidShopDomain(shop: string): boolean {
  return /^[a-z0-9-]+\.myshopify\.com$/i.test(shop);
}
