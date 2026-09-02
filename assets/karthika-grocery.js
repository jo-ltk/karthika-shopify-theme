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

    async promoteAddedVariant(variantId, cartHint) {
      if (!window.CartItemOrder) return cartHint;

      let cart = cartHint?.items ? cartHint : null;
      if (!cart) {
        try {
          const cartResponse = await fetch(this.getCartEndpoint('cart'), {
            cache: 'no-store',
            credentials: 'same-origin',
          });
          if (!cartResponse.ok) return cartHint;
          cart = await cartResponse.json();
        } catch (e) {
          return cartHint;
        }
      }

      const line = (cart.items || []).find(
        (item) => Number(item.variant_id) === Number(variantId) || Number(item.id) === Number(variantId)
      );
      const lineKey = line?.key || cartHint?.key;
      if (!lineKey) return cart;

      return window.CartItemOrder.promoteLine(cart, lineKey);
    },

    async refreshCartState(isInit = false) {
      try {
        const response = await fetch(this.getCartEndpoint('cart'));
        if (!response.ok) return;
        const cart = await response.json();
        this.processCartData(cart, isInit);
      } catch (err) {
        // Refresh failed silently
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
        const existingItem = (this.state.items || []).find(
          (item) => Number(item.variant_id) === vId || Number(item.id) === vId
        );
        const previousQty = existingItem?.quantity || 0;
        const isCurrentlyInCart = Boolean(existingItem);

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
            // If another change was queued in the meantime, don't rollback
            if (!this._pendingTimers[vId]) {
              await this.refreshCartState();
            }
            return;
          }

          let responseData = await response.json();

          // If another debounce was queued while request was in-flight, let that newer one proceed
          if (this._pendingTimers[vId]) return;

          if (finalQty > previousQty && window.CartItemOrder) {
            responseData = await this.promoteAddedVariant(vId, responseData);
          }

          // /cart/change returns full cart (with .items array).
          // /cart/add returns the added item object (without .items array), so we fetch fresh cart state.
          if (responseData && Array.isArray(responseData.items)) {
            this.processCartData(responseData, false);
          } else {
            await this.refreshCartState(false);
          }
        } catch (err) {
          // Silent catch on cart refresh
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
        const items = cart?.items || [];
        const sortedItems = window.CartItemOrder
          ? window.CartItemOrder.sortItems(items, cart?.attributes)
          : [...items].reverse();

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
     4. AI Shopping Assistant (Remix App Proxy)
     -------------------------------------------------------------------------- */
  const AIAssistantManager = {
    _isLoading: false,
    _requestSeq: 0,
    _matchedProducts: [],
    _loadingPhraseTimer: null,

    getProxyUrl() {
      const cardEl = document.querySelector('.karthika-ai-assistant-card');
      return cardEl?.getAttribute('data-ai-endpoint') || '/apps/karthika/recommend';
    },

    setLoading(isLoading) {
      this._isLoading = isLoading;
      const submitBtn = document.getElementById('KarthikaAISubmitBtn');
      const basketEl = document.querySelector('.karthika-ai-basket-box');

      if (!isLoading) this.stopLoadingPhrases();
      if (basketEl) basketEl.classList.toggle('is-ai-loading', !!isLoading);

      if (!submitBtn) return;

      if (isLoading) {
        if (!submitBtn.dataset.originalHtml) {
          submitBtn.dataset.originalHtml = submitBtn.innerHTML;
        }
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Thinking...</span>';
      } else {
        submitBtn.disabled = false;
        submitBtn.innerHTML = submitBtn.dataset.originalHtml || '<span>Ask AI</span>';
      }
    },

    stopLoadingPhrases() {
      if (this._loadingPhraseTimer) {
        clearInterval(this._loadingPhraseTimer);
        this._loadingPhraseTimer = null;
      }
    },

    startLoadingPhrases(titleEl, countEl, copyEl) {
      this.stopLoadingPhrases();

      const phrases = [
        { title: 'Finding ingredients...', sub: 'Searching store catalog...' },
        { title: 'Finding the best matches...', sub: 'Matching items to your dish...' },
        { title: 'Checking what’s fresh...', sub: 'Looking at what’s in stock...' },
        { title: 'Putting your basket together...', sub: 'Picking quantities and prices...' },
        { title: 'Almost ready...', sub: 'Finishing up...' },
      ];

      const apply = (phrase, animate) => {
        if (titleEl) titleEl.textContent = phrase.title;
        if (countEl) countEl.textContent = phrase.sub;
        if (copyEl) {
          copyEl.textContent = phrase.title;
          if (animate) {
            copyEl.classList.remove('is-swapping');
            void copyEl.offsetWidth;
            copyEl.classList.add('is-swapping');
          }
        }
      };

      apply(phrases[0], false);

      let index = 0;
      this._loadingPhraseTimer = setInterval(() => {
        if (!this._isLoading) {
          this.stopLoadingPhrases();
          return;
        }
        if (index >= phrases.length - 1) {
          this.stopLoadingPhrases();
          return;
        }
        index += 1;
        apply(phrases[index], true);
      }, 1600);
    },

    showBasketBox(show) {
      const basketEl = document.querySelector('.karthika-ai-basket-box');
      if (basketEl) basketEl.style.display = show ? '' : 'none';
    },

    showFallback(show) {
      const fallbackEl = document.getElementById('KarthikaAIFallbackMsg');
      if (fallbackEl) fallbackEl.style.display = show ? 'block' : 'none';
      this.showBasketBox(!show);
    },

    renderItemThumb(item) {
      const alt = (item.title || 'Product').replace(/"/g, '&quot;');
      if (item.image) {
        return `<img src="${item.image}" alt="${alt}" class="karthika-ai-item-thumb" width="44" height="44" loading="lazy">`;
      }
      return `<div class="karthika-ai-item-thumb karthika-compact-media-placeholder" aria-label="Product image unavailable" role="img"></div>`;
    },

    renderRecommendation(data) {
      const titleEl = document.getElementById('KarthikaAIRecipeTitle');
      const countEl = document.getElementById('KarthikaAIMatchedCount');
      const priceEl = document.getElementById('KarthikaAIRecipePrice');
      const listEl = document.getElementById('KarthikaAIIngredientList');
      const buildBtn = document.getElementById('KarthikaAIBuildBtn');

      if (!data || !data.dishName) return;

      const matched = data.matched || [];
      const unmatched = data.unmatched || [];
      this._matchedProducts = matched;

      if (titleEl) titleEl.textContent = data.dishName;
      if (priceEl) priceEl.textContent = `$${parseFloat(data.total || 0).toFixed(2)}`;

      if (countEl) {
        if (matched.length > 0) {
          countEl.textContent = `${matched.length} store item${matched.length > 1 ? 's' : ''} matched`;
          countEl.style.color = 'var(--karthika-green, #16A34A)';
        } else {
          countEl.textContent = 'No matching products in store';
          countEl.style.color = '#dc2626';
        }
      }

      if (listEl) {
        if (matched.length === 0 && unmatched.length === 0) {
          listEl.innerHTML = `
            <div class="karthika-ai-item-row" style="padding: 16px; text-align: center;">
              <span class="karthika-ai-item-name">No ingredients matched for this dish yet.</span>
            </div>
          `;
        } else {
          listEl.innerHTML = matched.map((item) => `
            <div class="karthika-ai-item-row">
              ${this.renderItemThumb(item)}
              <div class="karthika-ai-item-info">
                <span class="karthika-ai-item-name">${item.title}</span>
                <span class="karthika-ai-item-tag" style="color: var(--karthika-green, #16A34A);">
                  ✓ In stock (x${item.qty || 1})
                </span>
              </div>
              <span class="karthika-ai-item-price">$${parseFloat(item.price || 0).toFixed(2)}</span>
            </div>
          `).join('');

          if (unmatched.length > 0) {
            listEl.innerHTML += `
              <div class="karthika-ai-item-row" style="opacity: 0.75; background: #fafafa;">
                <div class="karthika-ai-item-info">
                  <span class="karthika-ai-item-name">Not currently available</span>
                  <span class="karthika-ai-item-tag" style="color: #6b7280;">
                    ${unmatched.join(', ')}
                  </span>
                </div>
              </div>
            `;
          }
        }
      }

      if (buildBtn) {
        const canAdd = matched.length > 0;
        buildBtn.disabled = !canAdd;
        buildBtn.style.opacity = canAdd ? '1' : '0.5';
        buildBtn.style.cursor = canAdd ? 'pointer' : 'not-allowed';
        buildBtn.innerHTML = canAdd
          ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <path d="M16 10a4 4 0 0 1-8 0"></path>
            </svg>
            <span>Add Available Items to Cart (${matched.length})</span>`
          : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            <span>Items not available in store</span>`;
      }
    },

    async sendRecommendationRequest(payload) {
      const requestId = ++this._requestSeq;

      this.showFallback(false);
      this.setLoading(true);

      const titleEl = document.getElementById('KarthikaAIRecipeTitle');
      const countEl = document.getElementById('KarthikaAIMatchedCount');
      const priceEl = document.getElementById('KarthikaAIRecipePrice');
      const listEl = document.getElementById('KarthikaAIIngredientList');

      if (priceEl) priceEl.textContent = '...';
      if (listEl) {
        listEl.innerHTML = `
          <div class="karthika-ai-loading" role="status" aria-live="polite">
            <div class="karthika-ai-loading-status">
              <span class="karthika-ai-loading-dots" aria-hidden="true"><i></i><i></i><i></i></span>
              <span class="karthika-ai-loading-copy">Finding ingredients...</span>
            </div>
            <div class="karthika-ai-loading-skel"><b></b><span><i></i><i></i></span></div>
            <div class="karthika-ai-loading-skel"><b></b><span><i></i><i></i></span></div>
            <div class="karthika-ai-loading-skel"><b></b><span><i></i><i></i></span></div>
          </div>
        `;
      }
      this.startLoadingPhrases(
        titleEl,
        countEl,
        listEl?.querySelector('.karthika-ai-loading-copy')
      );

      try {
        const response = await fetch(this.getProxyUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          console.warn('[Karthika AI] Non-JSON proxy response', response.status, contentType);
          this.showFallback(true);
          return;
        }

        const data = await response.json();

        if (requestId !== this._requestSeq) return;

        if (response.status === 401) {
          console.warn('[Karthika AI] App proxy auth failed (401)');
          this.showFallback(true);
          return;
        }

        if (data.fallback) {
          this.showFallback(true);
          return;
        }

        if (response.status === 404 || data.error === 'not found') {
          if (titleEl) titleEl.textContent = payload.dishName || 'Recipe not found';
          if (countEl) countEl.textContent = 'No recipe configured for this dish yet';
          if (priceEl) priceEl.textContent = '$0.00';
          if (listEl) {
            listEl.innerHTML = `
              <div class="karthika-ai-item-row" style="padding: 16px; text-align: center;">
                <span class="karthika-ai-item-name">This dish is not in the recipe catalog yet.</span>
              </div>
            `;
          }
          this._matchedProducts = [];
          const buildBtn = document.getElementById('KarthikaAIBuildBtn');
          if (buildBtn) buildBtn.disabled = true;
          return;
        }

        if (response.ok && data.dishName) {
          this.renderRecommendation(data);
        } else {
          this.showFallback(true);
        }
      } catch (err) {
        if (requestId === this._requestSeq) {
          this.showFallback(true);
        }
      } finally {
        if (requestId === this._requestSeq) {
          this.setLoading(false);
        }
      }
    },

    async buildAndAddBasket(btn) {
      const originalText = btn.innerHTML;
      btn.disabled = true;

      const itemsToAdd = (this._matchedProducts || [])
        .map((item) => {
          let rawId = item.variantId;
          if (typeof rawId === 'string' && rawId.includes('/')) {
            rawId = rawId.split('/').pop();
          }
          return {
            id: rawId,
            quantity: parseInt(item.qty, 10) || 1,
          };
        })
        .filter((item) => item.id);

      if (!itemsToAdd.length) {
        btn.disabled = false;
        btn.innerHTML = '<span style="font-size:12px;color:#c00">No items available in store</span>';
        setTimeout(() => { btn.innerHTML = originalText; }, 2000);
        return;
      }

      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="karthika-spin"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="10"></circle></svg><span>Adding ${itemsToAdd.length} items to cart...</span>`;

      const root = window.Shopify?.routes?.root || window.routes?.root || '/';
      const base = root.endsWith('/') ? root : root + '/';
      let successCount = 0;
      const addedKeysNewestFirst = [];

      for (const item of itemsToAdd) {
        try {
          const formData = new FormData();
          formData.append('id', String(item.id));
          formData.append('quantity', String(item.quantity));

          const res = await fetch(`${base}cart/add.js`, {
            method: 'POST',
            body: formData,
          });

          if (res.ok) {
            successCount++;
            try {
              const added = await res.json();
              if (added?.key) addedKeysNewestFirst.unshift(added.key);
            } catch (e) {}
          }
        } catch (e) {}
      }

      if (addedKeysNewestFirst.length && window.CartItemOrder?.promoteKeys) {
        try {
          await window.CartItemOrder.promoteKeys(addedKeysNewestFirst);
        } catch (e) {}
      }

      if (window.Karthika?.Cart?.refreshCartState) {
        try {
          await window.Karthika.Cart.refreshCartState(false);
        } catch (e) {}
      }

      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg><span>${successCount} item${successCount !== 1 ? 's' : ''} added! Redirecting...</span>`;
      btn.style.background = 'var(--karthika-green, #16A34A)';

      setTimeout(() => {
        const cartUrl = window.routes?.cart_url || '/cart';
        window.location.href = cartUrl;
      }, 700);
    },

    init() {
      const cardEl = document.querySelector('.karthika-ai-assistant-card');
      if (!cardEl) return;

      document.addEventListener('click', (e) => {
        const chip = e.target.closest('.karthika-ai-chip[data-dish]');
        if (!chip) return;
        e.preventDefault();

        document.querySelectorAll('.karthika-ai-chip').forEach((c) => c.classList.remove('is-active'));
        chip.classList.add('is-active');

        const dishName = chip.getAttribute('data-dish');
        if (dishName) {
          this.sendRecommendationRequest({ type: 'chip', dishName });
        }
      });

      const form = document.getElementById('KarthikaAIPromptForm');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const input = document.getElementById('KarthikaAIPromptInput');
          const query = input ? input.value.trim() : '';
          if (query) {
            document.querySelectorAll('.karthika-ai-chip').forEach((c) => c.classList.remove('is-active'));
            this.sendRecommendationRequest({ type: 'text', query });
          }
        });
      }

      document.addEventListener('click', (e) => {
        const btn = e.target.closest('#KarthikaAIBuildBtn');
        if (!btn || btn.disabled) return;
        this.buildAndAddBasket(btn);
      });

      const defaultChip = document.querySelector('.karthika-ai-chip.is-active[data-dish]');
      const defaultDish = defaultChip?.getAttribute('data-dish');
      if (defaultDish) {
        this.sendRecommendationRequest({ type: 'chip', dishName: defaultDish });
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

(function () {
  'use strict';

  function markReturnHome(href) {
    if (!href) return;
    if (
      href.indexOf('customer_authentication') !== -1 ||
      href.indexOf('/account/login') !== -1
    ) {
      try {
        sessionStorage.setItem('karthikaReturnHome', '1');
      } catch (err) {}
    }
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href], .karthika-login-home-link');
    if (!link) return;
    markReturnHome(link.getAttribute('href') || '');
  });
})();

/* ==========================================================================
   Karthika Account Profile - Orders/Profile tabs, Buy again, bottom sheets
   ========================================================================== */
(function () {
  'use strict';

  const TAB_STORAGE_KEY = 'karthikaAccountTab';
  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

  const AccountProfileManager = {
    root: null,
    _openSheet: null,
    _sheetOpenedBy: null,

    init() {
      this.root = document.querySelector('[data-kap]');
      this.bindSheets();
      if (!this.root) return;
      this.bindTabs();
      this.bindBuyAgain();
      this.restoreTab();
    },

    /* ---- Tabs ---- */

    bindTabs() {
      this.root.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-kap-tab]');
        if (!trigger) return;
        event.preventDefault();
        this.showTab(trigger.dataset.kapTab, true);
      });
    },

    restoreTab() {
      const hash = (window.location.hash || '').replace('#', '');
      const query = new URLSearchParams(window.location.search).get('tab');
      let stored = null;
      try {
        stored = sessionStorage.getItem(TAB_STORAGE_KEY);
      } catch (err) {}

      const requested = hash === 'orders' || hash === 'profile' ? hash : query || stored;
      if (requested === 'orders') this.showTab('orders', false);
    },

    showTab(name, scrollIntoView) {
      if (!name) return;

      const panels = this.root.querySelectorAll('[data-kap-panel]');
      let matched = false;
      panels.forEach((panel) => {
        const isMatch = panel.dataset.kapPanel === name;
        if (isMatch) matched = true;
        panel.toggleAttribute('hidden', !isMatch);
      });
      if (!matched) return;

      this.root.querySelectorAll('.kap-tab').forEach((tab) => {
        const isMatch = tab.dataset.kapTab === name;
        tab.classList.toggle('is-active', isMatch);
        tab.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });

      try {
        sessionStorage.setItem(TAB_STORAGE_KEY, name);
      } catch (err) {}

      if (scrollIntoView) {
        const header = this.root.querySelector('.kap-tabs') || this.root;
        header.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },

    /* ---- Buy again ---- */

    bindBuyAgain() {
      this.root.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-kap-buy-again]');
        if (!btn) return;
        event.preventDefault();
        this.buyAgain(btn);
      });
    },

    async buyAgain(btn) {
      if (btn.disabled) return;

      let items = [];
      try {
        items = JSON.parse(btn.dataset.kapOrderItems || '[]');
      } catch (err) {}
      items = items.filter((item) => item && item.id);

      const label = btn.querySelector('.kap-order__buy-label') || btn;
      const originalText = label.textContent;

      if (!items.length) {
        label.textContent = 'Unavailable';
        setTimeout(() => {
          label.textContent = originalText;
        }, 2000);
        return;
      }

      btn.disabled = true;
      label.textContent = 'Adding\u2026';

      const root = window.Shopify?.routes?.root || window.routes?.root || '/';
      const base = root.endsWith('/') ? root : root + '/';
      let successCount = 0;
      const addedKeysNewestFirst = [];

      for (const item of items) {
        try {
          const formData = new FormData();
          formData.append('id', String(item.id));
          formData.append('quantity', String(parseInt(item.quantity, 10) || 1));

          const res = await fetch(`${base}cart/add.js`, {
            method: 'POST',
            body: formData,
          });

          if (res.ok) {
            successCount++;
            try {
              const added = await res.json();
              if (added?.key) addedKeysNewestFirst.unshift(added.key);
            } catch (err) {}
          }
        } catch (err) {}
      }

      if (addedKeysNewestFirst.length && window.CartItemOrder?.promoteKeys) {
        try {
          await window.CartItemOrder.promoteKeys(addedKeysNewestFirst);
        } catch (err) {}
      }

      if (window.Karthika?.Cart?.refreshCartState) {
        try {
          await window.Karthika.Cart.refreshCartState(false);
        } catch (err) {}
      }

      if (!successCount) {
        btn.disabled = false;
        label.textContent = 'Try again';
        setTimeout(() => {
          label.textContent = originalText;
        }, 2200);
        return;
      }

      btn.classList.add('is-done');
      label.textContent = `${successCount} added`;

      setTimeout(() => {
        if (window.Karthika?.Cart?.openCartDrawer) window.Karthika.Cart.openCartDrawer();
        else window.location.href = window.routes?.cart_url || '/cart';
      }, 650);
    },

    /* ---- Bottom sheets ---- */

    bindSheets() {
      document.addEventListener('click', (event) => {
        const opener = event.target.closest('[data-kap-sheet-open]');
        if (opener) {
          event.preventDefault();
          this.openSheet(document.getElementById(opener.dataset.kapSheetOpen), opener);
          return;
        }

        const closer = event.target.closest('[data-kap-sheet-close]');
        if (closer) {
          event.preventDefault();
          this.closeSheet();
        }
      });

      document.addEventListener('keydown', (event) => {
        if (!this._openSheet) return;
        if (event.key === 'Escape') {
          this.closeSheet();
          return;
        }
        if (event.key === 'Tab') this.trapFocus(event);
      });
    },

    openSheet(sheet, opener) {
      if (!sheet) return;
      this._openSheet = sheet;
      this._sheetOpenedBy = opener || null;
      sheet.removeAttribute('hidden');
      void sheet.offsetWidth;
      sheet.classList.add('is-open');
      document.body.style.overflow = 'hidden';

      const first = sheet.querySelector(FOCUSABLE);
      if (first) first.focus();
    },

    closeSheet() {
      const sheet = this._openSheet;
      if (!sheet) return;
      this._openSheet = null;
      sheet.classList.remove('is-open');
      document.body.style.overflow = '';

      let settled = false;
      const finalise = () => {
        if (settled) return;
        settled = true;
        sheet.setAttribute('hidden', '');
        sheet.removeEventListener('transitionend', finalise);
      };
      sheet.addEventListener('transitionend', finalise);
      setTimeout(finalise, 400);

      const returnTarget = this._sheetOpenedBy;
      this._sheetOpenedBy = null;
      if (returnTarget) returnTarget.focus();
    },

    trapFocus(event) {
      const focusable = Array.from(this._openSheet.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
  };

  window.Karthika = window.Karthika || {};
  window.Karthika.AccountProfile = AccountProfileManager;

  document.addEventListener('DOMContentLoaded', () => {
    AccountProfileManager.init();
  });
})();