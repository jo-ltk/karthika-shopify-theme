/**
 * Karthika Supermarket - Client Grocery Engine
 * Handles cart state and product interactions against the Shopify Cart API.
 */

(function () {
  'use strict';

  window.Karthika = window.Karthika || {};

  const CartManager = {
    state: {
      item_count: 0,
      total_price: 0,
      items: [],
      variantMap: {}
    },

    // Per-variant debounce timers and pending network promise chains
    _pendingTimers: {},
    _activeRequests: {},

    getRoot() {
      return window.Shopify?.routes?.root || window.routes?.root || '/';
    },

    getCartEndpoint(action) {
      const root = this.getRoot();
      const base = root.endsWith('/') ? root : `${root}/`;
      return `${base}${action}.js`;
    },

    async init() {
      await this.refreshCartState(true);
      this.bindEvents();
      this.bindCartSummary();
      this.bindScrollNavigation();
      this.syncAllSteppers();
    },

    async refreshCartState(isInit = false) {
      try {
        const response = await fetch(this.getCartEndpoint('cart'));
        if (!response.ok) return;
        const cart = await response.json();
        this.processCartData(cart, isInit);
      } catch (err) {
        console.warn('[Karthika Cart] Refresh warning:', err);
      }
    },

    processCartData(cart, isInit = false) {
      let recents = [];
      try {
        recents = JSON.parse(localStorage.getItem('karthika_recent_variants')) || [];
      } catch(e) {}

      if (!isInit) {
        let updatedIds = [];
        (cart.items || []).forEach((item) => {
          if (item.quantity > (this.state.variantMap[item.variant_id] || 0)) {
            updatedIds.push(item.variant_id);
          }
        });
        recents = recents.filter(id => !updatedIds.includes(id));
        recents = [...updatedIds, ...recents];
      }

      const cartVariantIds = (cart.items || []).map(i => i.variant_id);
      recents = recents.filter(id => cartVariantIds.includes(id));

      cartVariantIds.forEach(id => {
        if (!recents.includes(id)) {
          recents.push(id);
        }
      });

      try {
        localStorage.setItem('karthika_recent_variants', JSON.stringify(recents));
      } catch(e) {}

      this.state.recentVariantIds = recents;
      this.state.item_count = cart.item_count || 0;
      this.state.total_price = cart.total_price || 0;
      this.state.items = cart.items || [];

      this.state.variantMap = {};
      this.state.items.forEach((item) => {
        this.state.variantMap[item.variant_id] = item.quantity || 0;
      });

      this.updateBadges();
      this.syncAllSteppers();
      document.dispatchEvent(new CustomEvent('karthika:cart-updated', { detail: cart }));
    },

    updateBadges() {
      const count = this.state.item_count || 0;
      document.querySelectorAll('.karthika-nav-badge, .karthika-cart-badge, .cart-count-bubble span').forEach((badge) => {
        badge.textContent = String(count);
        if (count > 0) {
          badge.style.display = 'flex';
          badge.classList.remove('hidden');
        } else {
          badge.style.display = 'none';
        }
      });
    },

    syncAllSteppers() {
      document.querySelectorAll('.karthika-stepper').forEach((stepper) => {
        const variantId = parseInt(stepper.dataset.variantId, 10);
        if (!variantId) return;

        const qty = this.state.variantMap[variantId] || 0;
        const qtyDisplay = stepper.querySelector('.karthika-stepper-qty');

        if (qty > 0) {
          stepper.classList.add('is-added');
          if (qtyDisplay) qtyDisplay.textContent = String(qty);
        } else {
          stepper.classList.remove('is-added');
          if (qtyDisplay) qtyDisplay.textContent = '1';
        }
      });
    },

    // Immediately sync all stepper UI elements for a specific variant
    syncVariantSteppers(variantId, qty) {
      const idStr = String(variantId);
      document.querySelectorAll(`.karthika-stepper[data-variant-id="${idStr}"]`).forEach((stepper) => {
        const qtyDisplay = stepper.querySelector('.karthika-stepper-qty');
        if (qty > 0) {
          stepper.classList.add('is-added');
          if (qtyDisplay) qtyDisplay.textContent = String(qty);
        } else {
          stepper.classList.remove('is-added');
          if (qtyDisplay) qtyDisplay.textContent = '1';
        }
      });
    },

    /**
     * Optimistically update local quantity and dispatch a debounced network sync.
     * Prevents race conditions by batching rapid clicks per-variant into a single /cart/change.js call.
     */
    setQuantityOptimistic(variantId, targetQty) {
      const vId = Number(variantId);
      if (!vId) return;

      const currentQty = this.state.variantMap[vId] || 0;
      const nextQty = Math.max(0, Number(targetQty));
      if (currentQty === nextQty && this._pendingTimers[vId] == null) return;

      // 1. Optimistic memory state update
      const diff = nextQty - currentQty;
      this.state.variantMap[vId] = nextQty;
      this.state.item_count = Math.max(0, (this.state.item_count || 0) + diff);

      // 2. Instant zero-latency UI update across all matching steppers & badges
      this.syncVariantSteppers(vId, nextQty);
      this.updateBadges();

      // Dispatch optimistic cart updated event for summary/floating cart
      document.dispatchEvent(new CustomEvent('karthika:cart-updated', {
        detail: {
          item_count: this.state.item_count,
          total_price: this.state.total_price,
          items: this.state.items
        }
      }));

      // 3. Clear existing debounce timer for this variant
      if (this._pendingTimers[vId]) {
        clearTimeout(this._pendingTimers[vId]);
      }

      // 4. Set debounce delay (~350ms) to coalesce rapid multi-clicks into 1 network call
      this._pendingTimers[vId] = setTimeout(() => {
        delete this._pendingTimers[vId];
        this._dispatchQueuedChange(vId, nextQty);
      }, 350);
    },

    /**
     * Dispatches the final coalesced quantity to /cart/change.js or /cart/add.js
     * and updates Cart state directly from the response.
     */
    async _dispatchQueuedChange(variantId, finalQty) {
      const vId = Number(variantId);
      // Chain onto existing active request for this variant if one is currently in-flight
      const previousPromise = this._activeRequests[vId] || Promise.resolve();

      const currentRequest = (async () => {
        try {
          await previousPromise;
        } catch (e) {}

        // If another debounce was queued while waiting, let that newer one handle it
        if (this._pendingTimers[vId]) return;

        // Check if item is already in Shopify server cart
        const isCurrentlyInCart = (this.state.items || []).some(item => Number(item.variant_id) === vId || Number(item.id) === vId);

        console.log(`[Karthika Cart] Syncing variant ${vId} -> finalQty: ${finalQty} (inCartOnServer: ${isCurrentlyInCart})`);

        try {
          let response;
          if (finalQty > 0 && !isCurrentlyInCart) {
            // New item being added to cart for the first time -> use /cart/add.js
            const formData = new FormData();
            formData.append('id', String(vId));
            formData.append('quantity', String(finalQty));
            response = await fetch(this.getCartEndpoint('cart/add'), {
              method: 'POST',
              body: formData
            });
          } else {
            // Existing item being updated (or reduced to 0) -> use /cart/change.js
            response = await fetch(this.getCartEndpoint('cart/change'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: String(vId), quantity: finalQty })
            });
          }

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            console.warn('[Karthika Cart] Request rejected by Shopify:', response.status, errData);
            // If another change was queued in the meantime, don't rollback
            if (!this._pendingTimers[vId]) {
              await this.refreshCartState();
            }
            return;
          }

          const responseData = await response.json();
          console.log('[Karthika Cart] Shopify response:', responseData);

          // If another debounce was queued while request was in-flight, let that newer one proceed
          if (this._pendingTimers[vId]) return;

          // /cart/change returns full cart (with .items array).
          // /cart/add returns the added item object (without .items array), so we fetch fresh cart state.
          if (responseData && Array.isArray(responseData.items)) {
            this.processCartData(responseData, false);
          } else {
            await this.refreshCartState(false);
          }
        } catch (err) {
          console.error('[Karthika Cart] Network error during cart sync, rolling back:', err);
          if (!this._pendingTimers[vId]) {
            await this.refreshCartState();
          }
        }
      })();

      this._activeRequests[vId] = currentRequest;
      try {
        await currentRequest;
      } finally {
        if (this._activeRequests[vId] === currentRequest) {
          delete this._activeRequests[vId];
        }
      }
    },

    async add(variantId, quantity = 1, openDrawer = false) {
      const currentQty = this.state.variantMap[Number(variantId)] || 0;
      this.setQuantityOptimistic(variantId, currentQty + Number(quantity));
      if (openDrawer) {
        this.openCartDrawer();
      }
    },

    async change(variantId, quantity) {
      this.setQuantityOptimistic(variantId, quantity);
    },

    openCartDrawer() {
      window.location.href = window.routes?.cart_url || '/cart';
    },

    bindCartSummary() {
      const summary = document.querySelector('.karthika-floating-cart');
      if (!summary) return;

      document.addEventListener('karthika:cart-updated', (event) => {
        this.renderCartSummary(event.detail, summary);
      });

      if (window.PUB_SUB_EVENTS && typeof subscribe === 'function') {
        subscribe(PUB_SUB_EVENTS.cartUpdate, (event) => {
          const cart = event?.cartData;
          if (cart?.items) this.processCartData(cart, false);
          else this.refreshCartState(false);
        });
      }

      summary.addEventListener('click', () => {
        window.location.href = window.routes?.cart_url || '/cart';
      });
    },

    renderCartSummary(cart, summary) {
      const count = cart?.item_count || 0;
      const countEl = summary.querySelector('.karthika-floating-cart-count');
      const badgeEl = summary.querySelector('.karthika-floating-cart-badge');
      const thumbnailsEl = summary.querySelector('.karthika-floating-cart-thumbnails');

      if (countEl) countEl.textContent = `${count} ITEMS`;
      if (badgeEl) badgeEl.textContent = count;
      if (thumbnailsEl) {
        const recents = this.state.recentVariantIds || [];
        const sortedItems = [...(cart?.items || [])].sort((a, b) => {
          const indexA = recents.indexOf(a.variant_id);
          const indexB = recents.indexOf(b.variant_id);
          const posA = indexA === -1 ? 999 : indexA;
          const posB = indexB === -1 ? 999 : indexB;
          return posB - posA;
        });

        const images = sortedItems.filter((item) => item.image).slice(0, 2).map((item) => {
          const image = document.createElement('img');
          image.src = item.image;
          image.alt = '';
          image.width = 38;
          image.height = 38;
          image.loading = 'lazy';
          return image;
        });
        thumbnailsEl.replaceChildren(...images);
      }

      summary.classList.toggle('is-empty', count === 0);
      summary.setAttribute('aria-hidden', count === 0 ? 'true' : 'false');
      summary.tabIndex = count === 0 ? -1 : 0;
      summary.setAttribute('aria-label', `View cart (${count} items)`);
      if (count > 0) {
        summary.classList.remove('is-updated');
        requestAnimationFrame(() => summary.classList.add('is-updated'));
      }
    },

    bindScrollNavigation() {
      const nav = document.querySelector('.karthika-bottom-nav');
      const summary = document.querySelector('.karthika-floating-cart');
      if (!nav) return;

      let lastScrollY = window.scrollY;
      window.addEventListener('scroll', () => {
        const currentScrollY = window.scrollY;
        const delta = currentScrollY - lastScrollY;
        if (Math.abs(delta) < 4) return;
        const isHidden = delta > 0 && currentScrollY > 24;
        nav.classList.toggle('is-hidden', isHidden);
        summary?.classList.toggle('is-nav-hidden', isHidden);
        lastScrollY = currentScrollY;
      }, { passive: true });
    },

    bindEvents() {
      document.addEventListener('click', (e) => {
        const addBtn = e.target.closest('.karthika-stepper-add-btn');
        if (addBtn) {
          const stepper = addBtn.closest('.karthika-stepper');
          const variantId = stepper?.dataset?.variantId;
          if (variantId) {
            this.setQuantityOptimistic(variantId, (this.state.variantMap[Number(variantId)] || 0) + 1);
          }
          return;
        }

        const minusBtn = e.target.closest('.karthika-stepper-btn--minus');
        if (minusBtn) {
          const stepper = minusBtn.closest('.karthika-stepper');
          const variantId = stepper?.dataset?.variantId;
          if (variantId) {
            const vId = Number(variantId);
            const currentQty = this.state.variantMap[vId] != null
              ? this.state.variantMap[vId]
              : parseInt(stepper.querySelector('.karthika-stepper-qty')?.textContent || '1', 10);
            const nextQty = Math.max(0, currentQty - 1);
            this.setQuantityOptimistic(vId, nextQty);
          }
          return;
        }

        const plusBtn = e.target.closest('.karthika-stepper-btn--plus');
        if (plusBtn) {
          const stepper = plusBtn.closest('.karthika-stepper');
          const variantId = stepper?.dataset?.variantId;
          if (variantId) {
            const vId = Number(variantId);
            const currentQty = this.state.variantMap[vId] != null
              ? this.state.variantMap[vId]
              : parseInt(stepper.querySelector('.karthika-stepper-qty')?.textContent || '1', 10);
            const nextQty = currentQty + 1;
            this.setQuantityOptimistic(vId, nextQty);
          }
          return;
        }

        const cartTrigger = e.target.closest('.karthika-cart-trigger');
        if (cartTrigger) {
          const href = cartTrigger.getAttribute('href');
          if (href && href !== '#' && !href.startsWith('javascript:')) {
            return;
          }
          e.preventDefault();
          this.openCartDrawer();
        }
      });
    }
  };

  /* --------------------------------------------------------------------------
     2. Location Selector Modal
     -------------------------------------------------------------------------- */
  const LocationManager = {
    init() {
      document.addEventListener('click', (e) => {
        const trigger = e.target.closest('.karthika-change-location-btn');
        if (trigger) {
          e.preventDefault();
          this.open();
          return;
        }

        const closeBtn = e.target.closest('.karthika-delivery-modal-close, .karthika-modal-backdrop');
        if (closeBtn && !e.target.closest('.karthika-modal-sheet')) {
          this.close();
          return;
        }

        const locationOption = e.target.closest('.karthika-location-item');
        if (locationOption) {
          const address = locationOption.dataset.address;
          if (address) this.setLocation(address);
        }
      });
    },

    open() {
      const modal = document.querySelector('#KarthikaDeliveryModal');
      if (modal) modal.classList.add('is-open');
    },

    close() {
      const modal = document.querySelector('#KarthikaDeliveryModal');
      if (modal) modal.classList.remove('is-open');
    },

    setLocation(address) {
      document.querySelectorAll('.karthika-delivery-address').forEach(el => {
        el.textContent = address;
      });
      document.querySelectorAll('.karthika-location-item').forEach(item => {
        if (item.dataset.address === address) {
          item.classList.add('is-selected');
        } else {
          item.classList.remove('is-selected');
        }
      });
      this.close();
    }
  };

  /* --------------------------------------------------------------------------
     3. Search Modal Overlay
     -------------------------------------------------------------------------- */
  const SearchManager = {
    init() {
      document.addEventListener('click', (e) => {
        const trigger = e.target.closest('.karthika-search-bar-trigger, .karthika-nav-search-trigger');
        if (trigger) {
          e.preventDefault();
          this.open();
          return;
        }

        const backBtn = e.target.closest('.karthika-search-modal-back');
        if (backBtn) {
          this.close();
          return;
        }

        const closeBtn = e.target.closest('.karthika-search-modal-close');
        if (closeBtn) {
          this.close();
          return;
        }

        // Clear recent searches
        const clearRecentBtn = e.target.closest('#karthikaClearRecentBtn');
        if (clearRecentBtn) {
          const recentGroup = document.querySelector('#karthikaRecentSearchesGroup');
          if (recentGroup) {
            recentGroup.style.display = 'none';
          }
          return;
        }

        // Remove single recent card
        const removeRecentBtn = e.target.closest('.karthika-recent-remove-btn');
        if (removeRecentBtn) {
          const card = removeRecentBtn.closest('.karthika-recent-card');
          if (card) {
            card.remove();
            const remaining = document.querySelectorAll('.karthika-recent-card');
            if (remaining.length === 0) {
              const recentGroup = document.querySelector('#karthikaRecentSearchesGroup');
              if (recentGroup) recentGroup.style.display = 'none';
            }
          }
          return;
        }

        // Query trigger clicks (recent cards, popular icons, category shortcuts)
        const searchChip = e.target.closest('.karthika-search-chip, .karthika-search-category, .karthika-recent-card-btn, .karthika-popular-icon-btn, .karthika-cat-card');
        if (searchChip) {
          const query = searchChip.dataset.query;
          if (query) {
            const input = document.querySelector('.karthika-search-modal-input');
            if (input) {
              input.value = query;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.closest('form')?.requestSubmit();
            }
          }
        }
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          const modal = document.querySelector('#KarthikaSearchModal');
          if (modal?.classList.contains('is-open')) {
            this.close();
          }
        }
      });

      document.addEventListener('input', (event) => {
        const input = event.target.closest('.karthika-search-modal-input');
        if (!input) return;
        this.syncEmptyState();
      });
    },

    syncEmptyState() {
      const modal = document.querySelector('#KarthikaSearchModal');
      if (!modal) return;
      const input = modal.querySelector('.karthika-search-modal-input');
      const hasQuery = !!(input && input.value.trim().length > 0);
      modal.classList.toggle('has-query', hasQuery);

      document.querySelectorAll('.karthika-nav-search-trigger').forEach((trigger) => {
        trigger.classList.toggle('is-active', modal.classList.contains('is-open'));
      });
    },

    open() {
      const modal = document.querySelector('#KarthikaSearchModal');
      if (modal) {
        modal.classList.add('is-open');
        this.syncEmptyState();
        setTimeout(() => {
          modal.querySelector('.karthika-search-modal-input')?.focus();
        }, 100);
      }
    },

    close() {
      const modal = document.querySelector('#KarthikaSearchModal');
      if (!modal) return;
      modal.classList.remove('is-open');
      this.syncEmptyState();
      document.querySelectorAll('.karthika-nav-search-trigger').forEach((trigger) => {
        trigger.classList.remove('is-active');
      });
    }
  };

  /* --------------------------------------------------------------------------
     4. AI Shopping Assistant Interactive Recipes
     -------------------------------------------------------------------------- */
  const recipes = {
    biryani: {
      title: "Malabar Chicken Biryani Kit",
      price: "$24.50",
      ingredients: [
        "v Kaima Jeerakasala Biryani Rice (1kg) - $4.80",
        "v Fresh Farm Chicken Curry Cut (1kg) - $9.50",
        "v Eastern Biryani Masala & Pure Ghee - $4.40",
        "v Fresh Mint Leaves, Coriander & Onions - $5.80"
      ]
    },
    kerala_breakfast: {
      title: "Kerala Appam & Stew Kit",
      price: "$14.20",
      ingredients: [
        "v Brahmins Easy Appam Mix (1kg) - $3.60",
        "v Pure Coconut Milk Can (400ml) - $2.80",
        "v Fresh Stew Veggies (Potato, Carrot, Beans) - $4.80",
        "v Whole Kerala Spices & Ginger Pack - $3.00"
      ]
    },
    sambar: {
      title: "Authentic Sambar & Rasam Kit",
      price: "$11.80",
      ingredients: [
        "v Karthika Premium Toor Dal (1kg) - $3.50",
        "v MTR Traditional Sambar Powder - $2.40",
        "v Sambar Veggies (Drumstick, Shallots, Tomato) - $4.10",
        "v Natural Tamarind Block (200g) - $1.80"
      ]
    },
    tea_snacks: {
      title: "Kerala Evening Chai & Snacks Combo",
      price: "$13.90",
      ingredients: [
        "v Crispy Kerala Banana Chips (250g) - $4.50",
        "v Spicy Mixture & Ribbon Pakoda - $3.80",
        "v AVT Premium Kerala Dust Tea (500g) - $5.60"
      ]
    }
  };

  const AIAssistantManager = {
    _isLoading: false,
    _matchedProducts: [],

    getCatalog() {
      const catalogEl = document.getElementById('KarthikaCatalogVariants');
      if (catalogEl) {
        try { 
          const parsed = JSON.parse(catalogEl.textContent || '[]'); 
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        } catch(e) {}
      }

      // Extract from page DOM products if JSON script was empty
      const domProducts = [];
      document.querySelectorAll('.karthika-compact-card[data-variant-id]').forEach(card => {
        const id = parseInt(card.dataset.variantId, 10);
        const title = card.querySelector('.karthika-compact-title')?.textContent?.trim() || '';
        const price = card.querySelector('.karthika-price-current')?.textContent?.trim() || '$3.50';
        const img = card.querySelector('.karthika-compact-img')?.src || '';
        if (id && title && !domProducts.some(p => p.id === id)) {
          domProducts.push({ id, title, price, image: img, price_raw: 350 });
        }
      });
      return domProducts;
    },

    matchAndRenderStoreProducts(title, targetPrice, ingredientNames) {
      const catalog = this.getCatalog();
      let matched = [];

      // Default grocery image dictionary for authentic Indian / Kerala ingredients
      const fallbackImages = {
        rice: "https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=120&q=80",
        biryani: "https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=120&q=80",
        chicken: "https://images.unsplash.com/photo-1604503468506-a8da13d82791?auto=format&fit=crop&w=120&q=80",
        meat: "https://images.unsplash.com/photo-1604503468506-a8da13d82791?auto=format&fit=crop&w=120&q=80",
        coconut: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=120&q=80",
        masala: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=120&q=80",
        curry: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=120&q=80",
        spice: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=120&q=80",
        onion: "https://images.unsplash.com/photo-1509358271058-acd22cc93898?auto=format&fit=crop&w=120&q=80",
        vegetable: "https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=120&q=80",
        appam: "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=120&q=80",
        tea: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=120&q=80",
        chips: "https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=120&q=80"
      };

      const getFallbackImg = (name) => {
        const lower = name.toLowerCase();
        for (const key in fallbackImages) {
          if (lower.includes(key)) return fallbackImages[key];
        }
        return "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=120&q=80";
      };

      // 1. Try matching against catalog
      ingredientNames.forEach(ing => {
        const cleanName = ing.replace(/^v\s*|✓\s*/, '').trim();
        const parts = cleanName.split(/—|-/);
        const itemName = (parts[0] || cleanName).trim();
        const itemPrice = (parts[1] || '').trim();

        const keywords = itemName.toLowerCase().replace(/[(),&—\-$0-9.]/g, ' ').split(' ').filter(w => w.length > 2);
        
        let found = catalog.find(p => {
          const pTitle = p.title.toLowerCase();
          return keywords.some(kw => pTitle.includes(kw));
        });

        if (found && !matched.some(m => m.id === found.id)) {
          matched.push(found);
        } else {
          // Create product item with proper image
          matched.push({
            id: catalog[matched.length % (catalog.length || 1)]?.id || 1,
            title: itemName,
            price: itemPrice || '$3.80',
            image: getFallbackImg(itemName),
            price_raw: 380
          });
        }
      });

      this._matchedProducts = matched;

      this.renderBasketUI(title, targetPrice, matched);
    },

    renderBasketUI(title, price, matchedItems) {
      const titleEl = document.getElementById('KarthikaAIRecipeTitle');
      const countEl = document.getElementById('KarthikaAIMatchedCount');
      const priceEl = document.getElementById('KarthikaAIRecipePrice');
      const listEl = document.getElementById('KarthikaAIIngredientList');

      if (titleEl) titleEl.textContent = title;
      if (priceEl) priceEl.textContent = price;
      if (countEl) countEl.textContent = `${matchedItems.length} store items available`;

      if (listEl) {
        listEl.innerHTML = matchedItems.map(item => `
          <div class="karthika-ai-item-row">
            <img 
              src="${item.image || 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=120&q=80'}" 
              alt="${item.title}" 
              class="karthika-ai-item-thumb" 
              loading="lazy"
            />
            <div class="karthika-ai-item-info">
              <span class="karthika-ai-item-name">${item.title}</span>
              <span class="karthika-ai-item-tag">✓ In Stock & Fresh</span>
            </div>
            <span class="karthika-ai-item-price">${item.price || '$3.80'}</span>
          </div>
        `).join('');
      }
    },

    async buildAndAddBasket(btn) {
      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="karthika-spin">
          <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="10"></circle>
        </svg>
        <span>Adding ${this._matchedProducts.length} items to cart...</span>
      `;

      let itemsToAdd = this._matchedProducts.map(p => ({
        id: p.id,
        quantity: 1
      }));

      // Fallback if no matched items
      if (!itemsToAdd.length) {
        const catalog = this.getCatalog();
        itemsToAdd = catalog.slice(0, 3).map(p => ({ id: p.id, quantity: 1 }));
      }

      try {
        const root = window.Shopify?.routes?.root || window.routes?.root || '/';
        const base = root.endsWith('/') ? root : `${root}/`;
        
        await fetch(`${base}cart/add.js`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: itemsToAdd })
        });
      } catch (err) {
        console.warn('[Karthika AI] Add to cart warning:', err);
      }

      // Visual feedback & Instant Redirect to /cart page
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>Added! Redirecting to Cart...</span>
      `;
      btn.style.background = 'var(--karthika-green, #16A34A)';

      setTimeout(() => {
        const cartUrl = window.routes?.cart_url || '/cart';
        window.location.href = cartUrl;
      }, 500);
    },

    init() {
      // Show default recipe (biryani) immediately on page load
      const defaultRecipe = recipes['biryani'];
      if (defaultRecipe) {
        this.matchAndRenderStoreProducts(
          defaultRecipe.title,
          defaultRecipe.price,
          defaultRecipe.ingredients
        );
      }

      // Chip buttons → load preset recipe
      document.addEventListener('click', (e) => {
        const chip = e.target.closest('.karthika-ai-chip[data-recipe]');
        if (!chip) return;
        e.preventDefault();

        // Toggle active chip style
        document.querySelectorAll('.karthika-ai-chip').forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');

        const key = chip.dataset.recipe;
        const recipe = recipes[key];
        if (recipe) {
          this.matchAndRenderStoreProducts(recipe.title, recipe.price, recipe.ingredients);
        }
      });

      // Form submit → Ask AI with free text
      const form = document.getElementById('KarthikaAIPromptForm');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const input = document.getElementById('KarthikaAIPromptInput');
          const query = input ? input.value.trim() : '';
          if (query) {
            this.generateRecipeWithAI(query);
          }
        });
      }

      // Build basket button
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('#KarthikaAIBuildBtn');
        if (!btn) return;
        this.buildAndAddBasket(btn);
      });
    },

    async generateRecipeWithAI(dishQuery) {
      this._isLoading = true;
      const submitBtn = document.getElementById('KarthikaAISubmitBtn');
      const listEl = document.getElementById('KarthikaAIIngredientList');
      const titleEl = document.getElementById('KarthikaAIRecipeTitle');
      const countEl = document.getElementById('KarthikaAIMatchedCount');
      const priceEl = document.getElementById('KarthikaAIRecipePrice');

      const originalBtnText = submitBtn ? submitBtn.innerHTML : 'Ask';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Thinking...</span>';
      }

      if (titleEl) titleEl.textContent = `Finding products for "${dishQuery}"...`;
      if (countEl) countEl.textContent = 'Searching store catalog...';
      if (priceEl) priceEl.textContent = '...';
      if (listEl) {
        listEl.innerHTML = `
          <div class="karthika-ai-item-row" style="opacity: 0.7;">
            <div class="karthika-ai-item-info">
              <span class="karthika-ai-item-name">🔍 Checking store stock for "${dishQuery}"...</span>
            </div>
          </div>
        `;
      }

      try {
        const cardEl = document.querySelector('.karthika-ai-assistant-card');
        const endpoint = cardEl?.getAttribute('data-ai-endpoint') || 'https://karthika-shopify-theme.onrender.com/api/ai-assistant';

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: dishQuery })
        });

        if (res.ok) {
          const data = await res.json();
          this.matchAndRenderStoreProducts(data.title, data.price, data.ingredients || []);
        } else {
          throw new Error('API failed');
        }
      } catch (err) {
        setTimeout(() => {
          this.matchAndRenderStoreProducts(
            `${dishQuery.charAt(0).toUpperCase() + dishQuery.slice(1)} Fresh Meal Kit`,
            '$16.80',
            [dishQuery, 'Curry Masala', 'Fresh Onions & Aromatics']
          );
        }, 500);
      } finally {
        this._isLoading = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnText;
        }
      }
    }
  };

  /* --------------------------------------------------------------------------
     5. Search Placeholder Rotator
     Rotates the search bar placeholder text through popular product names.
     Terms are sourced from data-search-terms on the .karthika-search-bar-trigger
     element so they can be updated in Liquid without touching JS.
     -------------------------------------------------------------------------- */
  const SearchPlaceholderRotator = {
    _timer: null,
    _index: 0,
    _terms: [],
    _INTERVAL: 3500,
    _FADE: 380,

    init() {
      const trigger = document.querySelector('[data-search-terms]');
      if (!trigger) return;

      const raw = trigger.getAttribute('data-search-terms') || '';
      this._terms = raw.split('|').map(t => t.trim()).filter(Boolean);
      if (this._terms.length < 2) return;

      this._index = Math.floor(Math.random() * this._terms.length);
      this._applyTerm(this._terms[this._index], false);
      this._schedule();
    },

    _schedule() {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this._rotate(), this._INTERVAL);
    },

    _rotate() {
      const modal = document.querySelector('#KarthikaSearchModal');
      const input = document.querySelector('.karthika-search-modal-input');
      const modalOpen = modal && modal.classList.contains('is-open');
      const hasValue = input && input.value.trim().length > 0;

      if (!modalOpen && !hasValue) {
        this._index = (this._index + 1) % this._terms.length;
        this._applyTerm(this._terms[this._index], true);
      }

      this._schedule();
    },

    _applyTerm(term, animate) {
      const spans = document.querySelectorAll('#KarthikaSearchPlaceholder, .karthika-search-placeholder-text');
      const input = document.querySelector('#KarthikaSearchModalInput');

      if (input) input.placeholder = term;

      if (!spans.length) return;

      if (!animate) {
        spans.forEach(span => { span.textContent = term; });
        return;
      }

      spans.forEach(span => {
        span.style.transition = 'opacity ' + this._FADE + 'ms ease';
        span.style.opacity = '0';
      });

      setTimeout(() => {
        spans.forEach(span => {
          span.textContent = term;
          span.style.opacity = '1';
        });
      }, this._FADE);
    }
  };

  // Expose on global object
  window.Karthika.Cart = CartManager;
  window.Karthika.Location = LocationManager;
  window.Karthika.Search = SearchManager;
  window.Karthika.AI = AIAssistantManager;
  window.Karthika.SearchPlaceholder = SearchPlaceholderRotator;

  // Initialize all managers on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    CartManager.init();
    LocationManager.init();
    SearchManager.init();
    AIAssistantManager.init();
    SearchPlaceholderRotator.init();
  });
})();

/* ==========================================================================
   Karthika Account Screen - Mobile overlay open/close
   ========================================================================== */
(function () {
  'use strict';

  function isMobile() {
    return window.matchMedia('(max-width: 749px)').matches;
  }

  const AccountScreen = {
    overlay: null,
    backBtn: null,
    _openedBy: null,

    init() {
      this.overlay = document.getElementById('karthika-account-screen');
      this.backBtn = document.getElementById('kas-back-btn');

      if (!this.overlay) return;

      document.addEventListener('click', (e) => {
        const trigger = e.target.closest('.karthika-account-trigger');
        if (!trigger) return;

        if (trigger.dataset.customerState === 'signed-in') {
          const href = trigger.dataset.accountHref;
          if (href) window.location.href = href;
          return;
        }

        if (!isMobile()) {
          const href = trigger.dataset.accountHref;
          if (href) window.location.href = href;
          return;
        }

        e.preventDefault();
        this._openedBy = trigger;
        this.open();
      });

      if (this.backBtn) {
        this.backBtn.addEventListener('click', () => this.close());
      }

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen()) this.close();
      });
    },

    isOpen() {
      return this.overlay && this.overlay.classList.contains('is-open');
    },

    open() {
      if (!this.overlay) return;
      this.overlay.removeAttribute('hidden');
      void this.overlay.offsetWidth;
      this.overlay.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      this.backBtn && this.backBtn.focus();
    },

    close() {
      if (!this.overlay) return;
      this.overlay.classList.remove('is-open');
      document.body.style.overflow = '';

      let settled = false;
      const finalise = () => {
        if (settled) return;
        settled = true;
        this.overlay.setAttribute('hidden', '');
        this.overlay.removeEventListener('transitionend', finalise);
      };
      this.overlay.addEventListener('transitionend', finalise);
      setTimeout(finalise, 400);

      const returnTarget = this._openedBy || document.querySelector('.karthika-account-trigger');
      this._openedBy = null;
      if (returnTarget) returnTarget.focus();
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    AccountScreen.init();
  });
})();