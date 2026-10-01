/**
 * Karthika Local Shopping Assistant
 * ─────────────────────────────────
 * Replaces the broken /apps/karthika/recommend AI endpoint with a
 * fully local, rule-based intent → ingredient engine.
 *
 * How it works:
 *   1. User types a query (e.g. "fish curry").
 *   2. We match it against INTENT_MAP to get an ordered list of
 *      ingredient search terms (e.g. ["fish", "coconut milk", …]).
 *   3. For each term we call Shopify's /search/suggest.json to find
 *      the best real product from the live catalogue.
 *   4. We render real product cards (same HTML as karthika-card-product.liquid)
 *      directly into the [data-karthika-ai-list] container.
 *   5. "Add available items (N)" button adds all matched variant IDs to cart.
 *
 * No external API. No fake products. No fake prices.
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────────────
     INTENT MAP
     Keys   : lowercase strings / patterns the user might type.
     Values : ordered array of Shopify search terms for each ingredient.
              Each term is sent to /search/suggest.json as the query.
              Put the most important ingredient first.
  ───────────────────────────────────────────────────────────────────────── */
  var INTENT_MAP = [
    // ── Fish dishes ──────────────────────────────────────────────────────
    {
      patterns: ['fish curry', 'fish gravy', 'meen curry'],
      label: 'Fish Curry',
      terms: ['fish', 'coconut milk', 'curry leaves', 'chilli powder', 'turmeric', 'coriander powder', 'rice']
    },
    {
      patterns: ['fish fry', 'fried fish', 'fish masala'],
      label: 'Fish Fry',
      terms: ['fish', 'chilli powder', 'turmeric', 'pepper', 'curry leaves', 'oil', 'rice']
    },
    {
      patterns: ['fish'],
      label: 'Fish',
      terms: ['fish', 'turmeric', 'chilli powder', 'curry leaves', 'coconut oil']
    },

    // ── Chicken dishes ───────────────────────────────────────────────────
    {
      patterns: ['chicken biryani'],
      label: 'Chicken Biryani',
      terms: ['basmati rice', 'chicken', 'onion', 'tomato', 'ginger garlic paste', 'biryani masala', 'mint', 'coriander', 'ghee']
    },
    {
      patterns: ['chicken curry', 'chicken gravy', 'chicken masala'],
      label: 'Chicken Curry',
      terms: ['chicken', 'onion', 'tomato', 'ginger garlic paste', 'chilli powder', 'turmeric', 'garam masala', 'rice']
    },
    {
      patterns: ['chicken'],
      label: 'Chicken',
      terms: ['chicken', 'onion', 'tomato', 'ginger garlic paste', 'chilli powder', 'turmeric', 'oil']
    },

    // ── Mutton / Lamb ────────────────────────────────────────────────────
    {
      patterns: ['mutton biryani', 'lamb biryani'],
      label: 'Mutton Biryani',
      terms: ['basmati rice', 'mutton', 'onion', 'tomato', 'ginger garlic paste', 'biryani masala', 'mint', 'coriander', 'ghee']
    },
    {
      patterns: ['mutton curry', 'mutton masala', 'lamb curry'],
      label: 'Mutton Curry',
      terms: ['mutton', 'onion', 'tomato', 'ginger garlic paste', 'chilli powder', 'turmeric', 'garam masala', 'rice']
    },

    // ── Biryani (generic) ────────────────────────────────────────────────
    {
      patterns: ['biryani', 'biriyani'],
      label: 'Biryani',
      terms: ['basmati rice', 'chicken', 'onion', 'tomato', 'ginger garlic paste', 'biryani masala', 'mint', 'coriander', 'ghee']
    },

    // ── Vegetable / Veg dishes ───────────────────────────────────────────
    {
      patterns: ['vegetable curry', 'veg curry', 'sambar', 'vegetable stew'],
      label: 'Vegetable Curry',
      terms: ['mixed vegetables', 'coconut milk', 'onion', 'tomato', 'curry leaves', 'turmeric', 'chilli powder', 'rice']
    },
    {
      patterns: ['dal', 'dhal', 'lentil curry', 'parippu'],
      label: 'Dal / Parippu',
      terms: ['lentils', 'turmeric', 'onion', 'tomato', 'ghee', 'cumin', 'chilli powder', 'rice']
    },

    // ── Rice ─────────────────────────────────────────────────────────────
    {
      patterns: ['rice', 'white rice', 'steamed rice'],
      label: 'Rice',
      terms: ['rice', 'ghee', 'cumin', 'salt']
    },

    // ── Breakfast ────────────────────────────────────────────────────────
    {
      patterns: ['breakfast', 'morning'],
      label: 'Breakfast Essentials',
      terms: ['bread', 'eggs', 'milk', 'butter', 'cereal', 'jam', 'tea', 'coffee']
    },
    {
      patterns: ['idli', 'dosa', 'idly'],
      label: 'Idli / Dosa',
      terms: ['idli rice', 'urad dal', 'fenugreek seeds', 'coconut chutney', 'sambar powder', 'oil']
    },

    // ── Tea & Coffee ─────────────────────────────────────────────────────
    {
      patterns: ['tea', 'chai', 'masala chai'],
      label: 'Tea Time',
      terms: ['tea', 'milk', 'sugar', 'biscuits', 'cardamom']
    },
    {
      patterns: ['coffee'],
      label: 'Coffee Time',
      terms: ['coffee', 'milk', 'sugar', 'biscuits']
    },

    // ── Snacks ───────────────────────────────────────────────────────────
    {
      patterns: ['snacks', 'snack', 'munchies', 'evening snack'],
      label: 'Snacks',
      terms: ['chips', 'biscuits', 'nuts', 'namkeen', 'murukku', 'mixture']
    },

    // ── Dinner ───────────────────────────────────────────────────────────
    {
      patterns: ['dinner'],
      label: 'Dinner Essentials',
      terms: ['rice', 'dal', 'onion', 'tomato', 'oil', 'spices', 'chapati', 'bread']
    },

    // ── Lunch ────────────────────────────────────────────────────────────
    {
      patterns: ['lunch'],
      label: 'Lunch Essentials',
      terms: ['rice', 'dal', 'vegetables', 'pickle', 'papad', 'curd']
    },

    // ── Kerala cooking ───────────────────────────────────────────────────
    {
      patterns: ['kerala', 'kerala cooking', 'kerala meal', 'sadya'],
      label: 'Kerala Cooking',
      terms: ['coconut oil', 'coconut milk', 'curry leaves', 'mustard seeds', 'turmeric', 'red chilli', 'rice', 'lentils']
    }
  ];

  /* ─────────────────────────────────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────────────────────────────────── */

  /** Normalise a user query for matching */
  function normalise(str) {
    return String(str || '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /** Find the best intent entry for a query string */
  function matchIntent(query) {
    var q = normalise(query);
    for (var i = 0; i < INTENT_MAP.length; i++) {
      var entry = INTENT_MAP[i];
      for (var j = 0; j < entry.patterns.length; j++) {
        var pattern = normalise(entry.patterns[j]);
        // Exact match first
        if (q === pattern) return entry;
        // Contains match (e.g. "make fish curry please" → "fish curry")
        if (q.indexOf(pattern) !== -1) return entry;
      }
    }
    return null;
  }

  /** Shopify storefront search – returns the first matching product or null */
  function searchProduct(term) {
    var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root)
      || (window.routes && window.routes.root)
      || '/';
    if (!root.endsWith('/')) root += '/';

    var url = root + 'search/suggest.json'
      + '?q=' + encodeURIComponent(term)
      + '&resources[type]=product'
      + '&resources[limit]=3'
      + '&resources[options][unavailable_products]=last';

    return fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        var products = json
          && json.resources
          && json.resources.results
          && json.resources.results.products;
        if (!Array.isArray(products) || products.length === 0) return null;
        // Prefer the first available product
        var available = products.filter(function (p) { return p.available !== false; });
        return (available[0] || products[0]) || null;
      })
      .catch(function () { return null; });
  }

  /**
   * Extract an image URL from a Shopify suggest.json product object.
   * featured_image can be a string URL or an object { url, alt, ... }.
   */
  function extractImageUrl(product) {
    var fi = product.featured_image;
    if (!fi) return '';
    if (typeof fi === 'string') return fi;
    if (typeof fi === 'object') return fi.url || fi.src || '';
    return '';
  }

  /**
   * Extract the display price from a Shopify suggest.json product.
   * The API returns `price` as a pre-formatted string (e.g. "₹120.00") in
   * presentment currency — ready to display as-is.
   * `price_min` is the raw integer in cents for numeric comparison only.
   */
  function extractPrice(product) {
    // price is a formatted string from suggest.json
    if (product.price && typeof product.price === 'string') return product.price;
    // Fallback: format price_min (cents) ourselves
    if (product.price_min) {
      var cents = parseInt(product.price_min, 10);
      if (!isNaN(cents)) {
        var currency = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || 'INR';
        try {
          return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency, maximumFractionDigits: 2 }).format(cents / 100);
        } catch (e) {
          return currency + '\u00a0' + (cents / 100).toFixed(2);
        }
      }
    }
    return '';
  }

  /**
   * Extract compare-at price string (for sale badge).
   * Returns '' if no compare-at, or if it equals price.
   */
  function extractComparePrice(product) {
    if (product.compare_at_price && typeof product.compare_at_price === 'string') return product.compare_at_price;
    if (product.compare_at_price_min && typeof product.compare_at_price_min === 'string') return product.compare_at_price_min;
    return '';
  }

  /**
   * Parse a Shopify formatted money string into a numeric float.
   * e.g. "₹120.00" → 120, "Rs. 1,200.50" → 1200.5
   */
  function parseMoneyString(str) {
    if (!str) return 0;
    var numeric = String(str).replace(/[^0-9.,]/g, '').replace(/,/g, '');
    return parseFloat(numeric) || 0;
  }

  /** Escape HTML special chars */
  function esc(val) {
    return String(val || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ─────────────────────────────────────────────────────────────────────────
     STYLES — injected once into <head>
  ───────────────────────────────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('kla-styles')) return;
    var style = document.createElement('style');
    style.id = 'kla-styles';
    style.textContent = [
      /* ── List container ─────────────────────────────────────────────── */
      '.kla-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0; }',

      /* ── Row ─────────────────────────────────────────────────────────── */
      '.kla-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f0f0f0; }',
      '.kla-row:last-child { border-bottom: none; }',

      /* ── Thumb ───────────────────────────────────────────────────────── */
      '.kla-thumb { flex: 0 0 56px; width: 56px; height: 56px; border-radius: 10px; overflow: hidden; background: #f7f7f7; display: flex; align-items: center; justify-content: center; }',
      '.kla-thumb img { width: 56px; height: 56px; object-fit: cover; display: block; }',
      '.kla-thumb-placeholder { width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #aaa; text-align: center; padding: 4px; line-height: 1.2; }',

      /* ── Info ────────────────────────────────────────────────────────── */
      '.kla-info { flex: 1 1 auto; min-width: 0; }',
      '.kla-name { font-size: 13px; font-weight: 600; color: #1a1a1a; margin: 0 0 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }',
      '.kla-name a { color: inherit; text-decoration: none; }',
      '.kla-name a:hover { text-decoration: underline; }',
      '.kla-meta { display: flex; align-items: center; gap: 6px; }',
      '.kla-price { font-size: 13px; font-weight: 700; color: #2a7a2a; }',
      '.kla-price-compare { font-size: 11px; color: #999; text-decoration: line-through; }',
      '.kla-sold-out-tag { font-size: 10px; color: #999; font-weight: 500; }',

      /* ── Per-row action ──────────────────────────────────────────────── */
      '.kla-action { flex: 0 0 auto; }',

      /* ── Per-row stepper ─────────────────────────────────────────────── */
      /* Container */
      '.kla-stepper { position: relative; width: 88px; height: 34px; flex-shrink: 0; }',
      /* +ADD button — visible by default, hidden once added */
      '.kla-stepper .karthika-stepper-add-btn { position: absolute; inset: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; gap: 4px; background: #fff; border: 1.5px solid #2a7a2a; border-radius: 8px; color: #2a7a2a; font-size: 13px; font-weight: 800; cursor: pointer; box-sizing: border-box; padding: 0; transition: background 0.15s, color 0.15s; -webkit-tap-highlight-color: transparent; }',
      '.kla-stepper .karthika-stepper-add-btn:hover { background: #2a7a2a; color: #fff; }',
      /* Stepper — hidden by default, shown once added */
      '.kla-stepper .karthika-compact-stepper { position: absolute; inset: 0; width: 100%; height: 100%; display: none; align-items: center; justify-content: space-between; background: #2a7a2a; border-radius: 8px; box-sizing: border-box; color: #fff; user-select: none; }',
      '.kla-stepper.is-added .karthika-stepper-add-btn { display: none; }',
      '.kla-stepper.is-added .karthika-compact-stepper { display: flex; }',
      /* Minus / Plus buttons */
      '.kla-stepper .karthika-stepper-act-btn { background: transparent; border: none; color: #fff; width: 28px; height: 100%; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; flex-shrink: 0; -webkit-tap-highlight-color: transparent; }',
      '.kla-stepper .karthika-stepper-act-btn:active { background: rgba(0,0,0,0.15); }',
      /* Quantity value */
      '.kla-stepper .karthika-stepper-qty { flex: 1; text-align: center; font-size: 13px; font-weight: 800; color: #fff; line-height: 1; }',

      /* ── Add all button ──────────────────────────────────────────────── */
      '.kla-add-all-btn { display: block; width: 100%; margin-top: 14px; padding: 13px 16px; background: #2a7a2a; color: #fff; font-size: 14px; font-weight: 700; border: none; border-radius: 12px; cursor: pointer; letter-spacing: 0.02em; transition: background 0.15s; }',
      '.kla-add-all-btn:disabled { background: #b0b0b0; cursor: default; }',
      '.kla-add-all-btn:not(:disabled):hover { background: #1f5e1f; }',

      /* ── Shimmer keyframe ────────────────────────────────────────────── */
      '@keyframes kla-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }',

      /* ── Skeleton wrapper ────────────────────────────────────────────── */
      '.kla-skeleton { padding: 4px 0; }',

      /* ── Skeleton row ────────────────────────────────────────────────── */
      '.kla-skel-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f0f0f0; }',
      '.kla-skel-row:last-child { border-bottom: none; }',

      /* ── Shimmer base ────────────────────────────────────────────────── */
      '.kla-skel-box { border-radius: 8px; background: linear-gradient(90deg, #efefef 25%, #e0e0e0 37%, #efefef 63%); background-size: 800px 100%; animation: kla-shimmer 1.4s ease infinite; }',

      /* ── Skeleton thumb ──────────────────────────────────────────────── */
      '.kla-skel-thumb { flex: 0 0 56px; width: 56px; height: 56px; border-radius: 10px; }',

      /* ── Skeleton lines ──────────────────────────────────────────────── */
      '.kla-skel-lines { flex: 1 1 auto; display: flex; flex-direction: column; gap: 7px; }',
      '.kla-skel-line { height: 11px; border-radius: 6px; }',
      '.kla-skel-line--title { width: 65%; }',
      '.kla-skel-line--price { width: 30%; }',

      /* ── Skeleton button ─────────────────────────────────────────────── */
      '.kla-skel-btn { flex: 0 0 72px; height: 32px; border-radius: 8px; }',

      /* ── Loading label ───────────────────────────────────────────────── */
      '.kla-loading-label { font-size: 12px; color: #888; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }',
      '@keyframes kla-spin { to { transform: rotate(360deg); } }',
      '.kla-loading-spinner { width: 13px; height: 13px; border: 2px solid #ddd; border-top-color: #2a7a2a; border-radius: 50%; animation: kla-spin 0.7s linear infinite; flex-shrink: 0; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  /** Build N skeleton rows for the loading state */
  function buildSkeletonHtml(count) {
    var rows = '';
    for (var i = 0; i < count; i++) {
      rows += '<div class="kla-skel-row">'
        + '<div class="kla-skel-box kla-skel-thumb"></div>'
        + '<div class="kla-skel-lines">'
        + '<div class="kla-skel-box kla-skel-line kla-skel-line--title"></div>'
        + '<div class="kla-skel-box kla-skel-line kla-skel-line--price"></div>'
        + '</div>'
        + '<div class="kla-skel-box kla-skel-btn"></div>'
        + '</div>';
    }
    return '<div class="kla-skeleton">'
      + '<div class="kla-loading-label"><span class="kla-loading-spinner"></span>Finding products\u2026</div>'
      + rows
      + '</div>';
  }

  /**
   * Build a horizontal list-row card for one product.
   * Uses karthika-stepper classes so the existing cart JS handles +/- automatically.
   */
  function buildProductCard(product) {
    var title = product.title || '';
    var handle = product.handle || '';
    var url = product.url || ('/products/' + encodeURIComponent(handle));
    var variantId = product.variants_min_id
      || (product.variants && product.variants[0] && product.variants[0].id)
      || '';
    var priceStr = extractPrice(product);
    var compareStr = extractComparePrice(product);
    var imageUrl = extractImageUrl(product);
    var isAvailable = product.available !== false;

    var thumbHtml = imageUrl
      ? '<img src="' + esc(imageUrl) + '" alt="" loading="lazy" width="56" height="56">'
      : '<div class="kla-thumb-placeholder">' + esc(title.substring(0, 16)) + '</div>';

    var priceHtml = priceStr
      ? '<span class="kla-price">' + esc(priceStr) + '</span>'
        + (compareStr ? '<span class="kla-price-compare">' + esc(compareStr) + '</span>' : '')
      : '';

    var actionHtml = isAvailable
      ? '<div class="karthika-stepper kla-stepper" data-variant-id="' + esc(variantId) + '" data-product-available="true">'
        + '<button type="button" class="karthika-stepper-add-btn" aria-label="Add ' + esc(title) + ' to cart">'
        + '<span class="karthika-add-btn-icon" aria-hidden="true">+</span>'
        + '<span class="karthika-add-btn-text">ADD</span>'
        + '</button>'
        + '<div class="karthika-compact-stepper">'
        + '<button type="button" class="karthika-stepper-act-btn karthika-stepper-btn--minus" aria-label="Decrease quantity">'
        + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.8"><line x1="5" y1="12" x2="19" y2="12"></line></svg>'
        + '</button>'
        + '<span class="karthika-stepper-qty karthika-compact-stepper-val" aria-live="polite" aria-atomic="true">1</span>'
        + '<button type="button" class="karthika-stepper-act-btn karthika-stepper-btn--plus" aria-label="Increase quantity">'
        + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.8"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>'
        + '</button>'
        + '</div>'
        + '</div>'
      : '<span class="kla-sold-out-tag">Sold out</span>';

    return '<li class="kla-row" data-product-handle="' + esc(handle) + '">'
      + '<div class="kla-thumb">' + thumbHtml + '</div>'
      + '<div class="kla-info">'
      + '<p class="kla-name"><a href="' + esc(url) + '">' + esc(title) + '</a></p>'
      + '<div class="kla-meta">' + priceHtml + '</div>'
      + '</div>'
      + '<div class="kla-action">' + actionHtml + '</div>'
      + '</li>';
  }

  /* ─────────────────────────────────────────────────────────────────────────
     CORE OVERRIDE
     We patch window.Karthika.AI.sendRecommendationRequest after the original
     karthika-grocery.js has already assigned it. This runs on DOMContentLoaded
     which fires after all synchronous scripts have parsed.
  ───────────────────────────────────────────────────────────────────────── */
  function patchAIManager() {
    var AI = window.Karthika && window.Karthika.AI;
    if (!AI) {
      setTimeout(patchAIManager, 50);
      return;
    }

    // Inject list styles once
    injectStyles();

    /**
     * Replaces the AI network call with local intent matching + Shopify search.
     * Same signature as the original so buildAndAddBasket still works.
     */
    AI.sendRecommendationRequest = function (payload) {
      var self = this;

      // Bail early if no AI root (section has enable_ai=false)
      if (!self.isEnabled()) return Promise.resolve();

      if (self._isLoading) return Promise.resolve();

      var query = String(payload.query || payload.dishName || '').trim().slice(0, self.MAX_QUERY || 200);
      if (!query) {
        self.setState('error', 'Enter a dish name or ingredient (e.g. fish curry, biryani).');
        return Promise.resolve();
      }

      // Abort any previous in-flight request
      if (self._abort) self._abort.abort();
      self._abort = { aborted: false, abort: function () { this.aborted = true; } };
      var currentAbort = self._abort;
      var requestId = (self._requestSeq = (self._requestSeq || 0) + 1);

      // ── Match intent (early, so skeleton count matches) ───────────────
      var intent = matchIntent(query);

      // ── UI: loading state ──────────────────────────────────────────────
      self._isLoading = true;
      self._matchedProducts = [];

      var root = self.getRoot();
      var listEl = root && root.querySelector('[data-karthika-ai-list]');
      var basketEl = root && root.querySelector('[data-karthika-ai-basket]');
      var submitBtn = root && root.querySelector('[data-karthika-ai-submit]');
      var titleEl = root && root.querySelector('[data-karthika-ai-title]');
      var countEl = root && root.querySelector('[data-karthika-ai-count]');
      var buildBtn = root && root.querySelector('[data-karthika-ai-add]');

      var skelCount = intent ? Math.min(intent.terms.length, 7) : 3;
      if (submitBtn) submitBtn.disabled = true;
      if (basketEl) { basketEl.hidden = false; basketEl.classList.add('is-ai-loading'); }
      if (titleEl) titleEl.textContent = '';
      if (countEl) countEl.textContent = '';
      if (buildBtn) { buildBtn.hidden = true; }
      if (listEl) listEl.innerHTML = buildSkeletonHtml(skelCount);

      if (!intent) {
        // No recipe match → fall back to a plain Shopify product search
        return searchProduct(query).then(function (product) {
          if (currentAbort.aborted || requestId !== self._requestSeq) return;

          self._isLoading = false;
          if (submitBtn) submitBtn.disabled = false;
          if (basketEl) basketEl.classList.remove('is-ai-loading');

          if (!product) {
            if (titleEl) titleEl.textContent = '';
            if (countEl) countEl.textContent = '';
            if (listEl) listEl.innerHTML = '<p style="margin:16px 4px 4px;color:#888;font-size:13px;">Sorry, no results found.</p>';
            if (buildBtn) { buildBtn.hidden = true; }
            return;
          }

          var variantId = product.variants_min_id
            || (product.variants && product.variants[0] && product.variants[0].id);
          if (variantId && product.available !== false) {
            self._matchedProducts = [{ variantId: Number(variantId), qty: 1, title: product.title, image: product.featured_image || '', handle: product.handle }];
          }

          if (titleEl) titleEl.textContent = product.title;
          if (countEl) countEl.textContent = '';
          if (listEl) listEl.innerHTML = '<ul class="kla-list" role="list">' + buildProductCard(product) + '</ul>';
          if (buildBtn) {
            buildBtn.hidden = false;
            buildBtn.disabled = self._matchedProducts.length === 0;
            buildBtn.textContent = 'Add to cart';
          }
          if (root) self.syncSteppersFromCart(root);
        });
      }

      // ── Search each ingredient in parallel ────────────────────────────
      var terms = intent.terms.slice(0, 12); // cap at 12 to avoid hammering search
      var promises = terms.map(function (term) {
        return searchProduct(term).then(function (p) {
          return { term: term, product: p };
        });
      });

      return Promise.all(promises).then(function (results) {
        if (currentAbort.aborted || requestId !== self._requestSeq) return;

        self._isLoading = false;
        if (submitBtn) submitBtn.disabled = false;
        if (basketEl) basketEl.classList.remove('is-ai-loading');

        // Deduplicate by product handle
        var seen = {};
        var cards = [];
        var matchedForCart = [];

        results.forEach(function (r) {
          if (!r.product) return;
          var handle = r.product.handle;
          if (seen[handle]) return;
          seen[handle] = true;

          var variantId = r.product.variants_min_id
            || (r.product.variants && r.product.variants[0] && r.product.variants[0].id);

          // Include all products (available or not) in the cart list;
          // cart/add.js will handle unavailable ones gracefully
          if (variantId) {
            if (r.product.available !== false) {
              matchedForCart.push({
                variantId: Number(variantId),
                qty: 1,
                title: r.product.title,
                image: r.product.featured_image || '',
                handle: handle
              });
            }
          }

          cards.push(buildProductCard(r.product));
        });

        self._matchedProducts = matchedForCart;

        var dishLabel = intent.label;
        // Title: clean label, no count text
        if (titleEl) titleEl.textContent = 'Items for ' + dishLabel;
        // Count element: hide it entirely
        if (countEl) countEl.textContent = '';

        if (listEl) {
          if (cards.length > 0) {
            listEl.innerHTML = '<ul class="kla-list" role="list">' + cards.join('') + '</ul>';
          } else {
            if (titleEl) titleEl.textContent = '';
            if (countEl) countEl.textContent = '';
            listEl.innerHTML = '<p style="margin:16px 4px 4px;color:#888;font-size:13px;">Sorry, no results found.</p>';
          }
        }

        if (buildBtn) {
          buildBtn.hidden = false;
          if (matchedForCart.length > 0) {
            buildBtn.disabled = false;
            buildBtn.textContent = 'Add all ' + matchedForCart.length + ' item' + (matchedForCart.length === 1 ? '' : 's') + ' to cart';
          } else if (cards.length > 0) {
            buildBtn.disabled = true;
            buildBtn.textContent = 'Add all to cart';
          } else {
            buildBtn.hidden = true;
          }
        }

        // Sync cart steppers so already-in-cart products show their qty
        if (root) self.syncSteppersFromCart(root);
      }).catch(function () {
        if (requestId !== self._requestSeq) return;
        self._isLoading = false;
        if (submitBtn) submitBtn.disabled = false;
        if (basketEl) basketEl.classList.remove('is-ai-loading');
        if (listEl) listEl.innerHTML = '';
        if (buildBtn) { buildBtn.hidden = true; }
      });
    };

    /**
     * Sync newly-injected stepper elements with the current cart state.
     * Calls into CartManager.syncAllSteppers which already handles this globally.
     */
    AI.syncSteppersFromCart = function (root) {
      if (window.Karthika && window.Karthika.Cart) {
        // Slight delay to ensure DOM is painted
        setTimeout(function () {
          window.Karthika.Cart.syncAllSteppers();
        }, 0);
      }
    };

    // Also patch init() so if it re-runs it won't re-bind against the old method
    var _origInit = AI.init.bind(AI);
    AI.init = function () {
      _origInit();
    };
  }

  // Run after all other scripts (karthika-grocery.js uses DOMContentLoaded too,
  // but this file is loaded after it in the section, so we use DOMContentLoaded
  // with a small guard to ensure Karthika.AI exists first).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchAIManager);
  } else {
    // DOM already ready (e.g. deferred/async load)
    patchAIManager();
  }
})();
