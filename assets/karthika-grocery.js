/**
 * Karthika Supermarket - Client Grocery Engine
 * Handles cart state and product interactions against the Shopify Cart API.
 */

(function () {
  'use strict';

  window.Karthika = window.Karthika || {};

  const CART_CUSTOMER_ERROR = "We couldn't update your cart. Please try again.";
  const CART_UNAVAILABLE_ERROR = 'This item is unavailable.';
  const CART_NETWORK_ERROR = "We couldn't reach the cart. Check your connection and try again.";
  const CART_TRIGGER_SELECTOR = [
    '.karthika-cart-trigger',
    '.karthika-header-cart-icon',
    '.karthika-desktop-header__cart',
    '.karthika-floating-cart',
    '.ks-cart-bar',
  ].join(', ');
  const CART_BADGE_SELECTOR = '.karthika-nav-badge, .karthika-cart-badge, .karthika-desktop-header__cart b, .cart-count-bubble span';

  const CartManager = {
    state: {
      item_count: 0,
      total_price: 0,
      items: [],
      variantMap: {}
    },

    // Per-variant debounce timers and pending network promise chains
    _pendingTimers: {},
    _desiredQty: {},
    _activeRequests: {},
    _addNowLocks: {},
    _dawnSubscribed: false,
    _eventsBound: false,
    _drawerObserver: null,

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
      this.bindDrawerObserver();
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

    async refreshCartState(isInit = false, options = {}) {
      try {
        const response = await fetch(this.getCartEndpoint('cart'), {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!response.ok) return null;
        const cart = await response.json();
        this.processCartData(cart, isInit, options);
        return cart;
      } catch (err) {
        return null;
      }
    },

    customerCartMessage(payload, fallback = CART_CUSTOMER_ERROR) {
      if (!payload) return fallback;
      const raw = payload.description || payload.message;
      if (typeof raw !== 'string' || !raw.trim()) return fallback;
      const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (/sold out|unavailable|inventory|not enough/i.test(text)) return CART_UNAVAILABLE_ERROR;
      if (text.length > 160) return fallback;
      return text || fallback;
    },

    ensureLiveRegion() {
      let live = document.getElementById('KarthikaCartLive');
      if (!live) {
        live = document.createElement('div');
        live.id = 'KarthikaCartLive';
        live.className = 'visually-hidden';
        live.setAttribute('role', 'status');
        live.setAttribute('aria-live', 'polite');
        live.setAttribute('aria-atomic', 'true');
        document.body.appendChild(live);
      }
      return live;
    },

    announce(message) {
      const live = this.ensureLiveRegion();
      live.textContent = '';
      window.requestAnimationFrame(() => {
        live.textContent = message;
      });
    },

    showCartError(message) {
      const text = message || CART_CUSTOMER_ERROR;
      this.announce(text);
      let toast = document.getElementById('KarthikaCartErrorToast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'KarthikaCartErrorToast';
        toast.className = 'karthika-cart-error-toast';
        toast.setAttribute('role', 'alert');
        document.body.appendChild(toast);
      }
      toast.textContent = text;
      toast.hidden = false;
      toast.classList.add('is-visible');
      window.clearTimeout(this._errorTimer);
      this._errorTimer = window.setTimeout(() => {
        toast.classList.remove('is-visible');
        toast.hidden = true;
      }, 4200);
    },

    getCartDrawer() {
      return document.querySelector('cart-drawer');
    },

    isCartResponseFailure(response, data) {
      return !response.ok || Boolean(data && (data.status || data.errors));
    },

    async readCartJson(response) {
      try {
        return await response.json();
      } catch (err) {
        return null;
      }
    },

    publishDawnCartUpdate(cart, extra = {}) {
      if (typeof publish !== 'function' || !window.PUB_SUB_EVENTS?.cartUpdate) return;
      publish(PUB_SUB_EVENTS.cartUpdate, {
        source: 'karthika',
        cartData: cart,
        ...extra,
      });
    },

    scheduleDrawerRefresh() {
      if (!this.getCartDrawer()) return;
      if (this._drawerRefreshTimer) window.clearTimeout(this._drawerRefreshTimer);
      this._drawerRefreshTimer = window.setTimeout(() => {
        this._drawerRefreshTimer = null;
        this.renderDrawerFromSection();
      }, 0);
    },

    async renderDrawerFromSection() {
      const drawer = this.getCartDrawer();
      const cartUrl = window.routes?.cart_url;
      if (!drawer || !cartUrl) return;
      try {
        const response = await fetch(`${cartUrl}?section_id=cart-drawer`, {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) return;
        const html = new DOMParser().parseFromString(await response.text(), 'text/html');
        const nextInner = html.querySelector('#CartDrawer .drawer__inner') || html.querySelector('.drawer__inner');
        const currentInner = drawer.querySelector('.drawer__inner');
        if (nextInner && currentInner) currentInner.replaceWith(nextInner);
        drawer.classList.toggle('is-empty', this.state.item_count === 0);
        // Overlay is a sibling of .drawer__inner and is not replaced here.
        // CartDrawer already binds overlay click in its constructor.
      } catch (err) {}
    },

    setStepperPending(variantId, pending) {
      document.querySelectorAll(`.karthika-stepper[data-variant-id="${variantId}"]`).forEach((stepper) => {
        stepper.classList.toggle('is-pending', pending);
        stepper.setAttribute('aria-busy', pending ? 'true' : 'false');
      });
    },

    processCartData(cart, isInit = false, options = {}) {
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
      if (!options.skipUi) this.syncAllSteppers();
      document.dispatchEvent(new CustomEvent('karthika:cart-updated', { detail: cart }));

      const drawer = this.getCartDrawer();
      if (drawer) drawer.classList.toggle('is-empty', this.state.item_count === 0);

      if (!isInit && !options.skipPublish) {
        this.publishDawnCartUpdate(cart);
        this.scheduleDrawerRefresh();
      }
    },

    updateBadges() {
      const count = this.state.item_count || 0;
      const label = `Cart (${count} ${count === 1 ? 'item' : 'items'})`;
      document.querySelectorAll(CART_BADGE_SELECTOR).forEach((badge) => {
        badge.textContent = String(count);
        if (count > 0) {
          badge.hidden = false;
          badge.removeAttribute('hidden');
          badge.style.removeProperty('display');
          badge.classList.remove('hidden');
        } else {
          badge.hidden = true;
          badge.style.display = 'none';
        }
      });
      document.querySelectorAll(CART_TRIGGER_SELECTOR).forEach((trigger) => {
        trigger.setAttribute('aria-label', label);
      });
      const searchBar = document.querySelector('.ks-cart-bar');
      if (searchBar) {
        const barLabel = searchBar.querySelector('.ks-cart-bar-label');
        if (barLabel) barLabel.textContent = `CART ${count} ITEM${count === 1 ? '' : 'S'}`;
        searchBar.hidden = count === 0;
        searchBar.classList.toggle('is-empty', count === 0);
        const thumbs = searchBar.querySelector('.ks-cart-bar-thumbs');
        if (thumbs) {
          const items = this.state.items || [];
          const sortedItems = window.CartItemOrder
            ? window.CartItemOrder.sortItems(items, null)
            : [...items].reverse();
          const images = sortedItems.filter((item) => item.image).slice(0, 3).map((item) => {
            const image = document.createElement('img');
            image.src = item.image;
            image.alt = '';
            image.width = 32;
            image.height = 32;
            image.className = 'ks-cart-thumb';
            image.loading = 'lazy';
            return image;
          });
          thumbs.replaceChildren(...images);
        }
      }
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

      const diff = nextQty - currentQty;
      this.state.variantMap[vId] = nextQty;
      this._desiredQty[vId] = nextQty;
      this.state.item_count = Math.max(0, (this.state.item_count || 0) + diff);

      this.syncVariantSteppers(vId, nextQty);
      this.updateBadges();

      document.dispatchEvent(new CustomEvent('karthika:cart-updated', {
        detail: {
          item_count: this.state.item_count,
          total_price: this.state.total_price,
          items: this.state.items
        }
      }));

      if (this._pendingTimers[vId]) {
        clearTimeout(this._pendingTimers[vId]);
      }

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
      const previousPromise = this._activeRequests[vId] || Promise.resolve();

      const currentRequest = (async () => {
        try {
          await previousPromise;
        } catch (e) {}

        if (this._pendingTimers[vId]) return;

        const existingItem = (this.state.items || []).find(
          (item) => Number(item.variant_id) === vId || Number(item.id) === vId
        );
        const previousQty = existingItem?.quantity || 0;
        const isCurrentlyInCart = Boolean(existingItem);
        this.setStepperPending(vId, true);

        try {
          let response;
          if (finalQty > 0 && !isCurrentlyInCart) {
            const formData = new FormData();
            formData.append('id', String(vId));
            formData.append('quantity', String(finalQty));
            response = await fetch(this.getCartEndpoint('cart/add'), {
              method: 'POST',
              body: formData,
              credentials: 'same-origin',
            });
          } else {
            response = await fetch(this.getCartEndpoint('cart/change'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({ id: String(vId), quantity: finalQty })
            });
          }

          const responseData = await this.readCartJson(response);
          const hasPending = Boolean(this._pendingTimers[vId]);

          if (this.isCartResponseFailure(response, responseData)) {
            if (!hasPending) {
              this.showCartError(this.customerCartMessage(responseData));
              await this.refreshCartState(false);
            }
            return;
          }

          let cartPayload = responseData;
          if (finalQty > previousQty && window.CartItemOrder) {
            cartPayload = await this.promoteAddedVariant(vId, responseData);
          }

          if (cartPayload && Array.isArray(cartPayload.items)) {
            this.processCartData(cartPayload, false, {
              skipPublish: hasPending,
              skipUi: hasPending,
            });
          } else if (cartPayload && (cartPayload.variant_id || cartPayload.id)) {
            const lineQty = Number(cartPayload.quantity) || finalQty;
            this.state.items = [
              ...(this.state.items || []).filter(
                (item) => Number(item.variant_id) !== vId && Number(item.id) !== vId
              ),
              {
                ...cartPayload,
                variant_id: Number(cartPayload.variant_id || cartPayload.id),
                quantity: lineQty,
              },
            ];
            if (!hasPending) await this.refreshCartState(false);
          } else if (!hasPending) {
            await this.refreshCartState(false);
          }

          if (hasPending && this._desiredQty[vId] != null) {
            this.syncVariantSteppers(vId, this._desiredQty[vId]);
            this.updateBadges();
          } else {
            delete this._desiredQty[vId];
            if (!hasPending) this.announce(`Cart updated. ${this.state.item_count} ${this.state.item_count === 1 ? 'item' : 'items'}.`);
          }
        } catch (err) {
          if (!this._pendingTimers[vId]) {
            this.showCartError(CART_NETWORK_ERROR);
            await this.refreshCartState(false);
          }
        } finally {
          if (!this._pendingTimers[vId] && !this._activeRequests[vId]) {
            this.setStepperPending(vId, false);
          } else if (!this._pendingTimers[vId]) {
            this.setStepperPending(vId, false);
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
        if (!this._pendingTimers[vId] && !this._activeRequests[vId]) {
          this.setStepperPending(vId, false);
        }
      }
    },

    async add(variantId, quantity = 1, openDrawer = false) {
      const currentQty = this.state.variantMap[Number(variantId)] || 0;
      this.setQuantityOptimistic(variantId, currentQty + Number(quantity));
      if (openDrawer) this.openCartDrawer();
    },

    async addNow(variantId, quantity = 1, options = {}) {
      const vId = Number(variantId);
      const qty = Number(quantity) || 1;
      if (!vId) return { ok: false, reason: 'invalid', message: CART_CUSTOMER_ERROR };
      if (this._addNowLocks[vId]) return { ok: false, reason: 'pending' };

      this._addNowLocks[vId] = true;
      this.setStepperPending(vId, true);
      try {
        const formData = new FormData();
        formData.append('id', String(vId));
        formData.append('quantity', String(qty));
        const response = await fetch(this.getCartEndpoint('cart/add'), {
          method: 'POST',
          body: formData,
          credentials: 'same-origin',
        });

        const responseData = await this.readCartJson(response);
        if (this.isCartResponseFailure(response, responseData)) {
          const message = this.customerCartMessage(responseData);
          if (!options.silent) this.showCartError(message);
          await this.refreshCartState(false);
          return { ok: false, reason: 'http', message };
        }

        let cartPayload = responseData;
        if (window.CartItemOrder) {
          cartPayload = await this.promoteAddedVariant(vId, responseData);
        }

        if (cartPayload && Array.isArray(cartPayload.items)) {
          this.processCartData(cartPayload, false);
        } else {
          await this.refreshCartState(false);
        }
        this.announce(`Cart updated. ${this.state.item_count} ${this.state.item_count === 1 ? 'item' : 'items'}.`);
        return { ok: true };
      } catch (err) {
        if (!options.silent) this.showCartError(CART_NETWORK_ERROR);
        await this.refreshCartState(false);
        return { ok: false, reason: 'network', message: CART_NETWORK_ERROR };
      } finally {
        delete this._addNowLocks[vId];
        this.setStepperPending(vId, false);
      }
    },

    async addMany(items) {
      const list = Array.isArray(items) ? items : [];
      let added = 0;
      let failed = 0;
      for (let i = 0; i < list.length; i += 1) {
        const item = list[i] || {};
        const variantId = Number(item.id || item.variantId);
        const quantity = Number(item.quantity) || 1;
        if (!variantId || quantity < 1) {
          failed += 1;
          continue;
        }
        const result = await this.addNow(variantId, quantity, { silent: true });
        if (result && result.ok) added += 1;
        else failed += 1;
      }
      return { added, failed, total: list.length };
    },

    async change(variantId, quantity) {
      this.setQuantityOptimistic(variantId, quantity);
    },

    syncDrawerTriggerState(isOpen) {
      document.querySelectorAll(CART_TRIGGER_SELECTOR).forEach((trigger) => {
        trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
    },

    bindDrawerObserver() {
      const drawer = this.getCartDrawer();
      if (!drawer || this._drawerObserver) return;
      this.syncDrawerTriggerState(drawer.classList.contains('active'));
      this._drawerObserver = new MutationObserver(() => {
        this.syncDrawerTriggerState(drawer.classList.contains('active'));
      });
      this._drawerObserver.observe(drawer, { attributes: true, attributeFilter: ['class'] });
    },

    openCartDrawer(triggeredBy) {
      if (window.Karthika?.Search?.close) {
        const search = document.querySelector('#KarthikaSearchModal.is-open');
        if (search) window.Karthika.Search.close({ restoreFocus: false });
      }

      const account = document.querySelector('.karthika-account-screen.is-open');
      if (account) {
        account.classList.remove('is-open');
        account.setAttribute('hidden', '');
      }

      const drawer = this.getCartDrawer();
      if (drawer && typeof drawer.open === 'function') {
        drawer.open(triggeredBy || document.activeElement);
        return;
      }

      const cartUrl = window.routes?.cart_url || '/cart';
      const current = window.location.pathname.replace(/\/$/, '');
      const target = String(cartUrl).replace(/\/$/, '');
      if (current !== target) window.location.href = cartUrl;
    },

    bindDawnCartSync() {
      if (this._dawnSubscribed) return;
      this._dawnSubscribed = true;
      if (!window.PUB_SUB_EVENTS || typeof subscribe !== 'function') return;
      subscribe(PUB_SUB_EVENTS.cartUpdate, (event) => {
        if (event?.source === 'karthika') return;
        const cart = event?.cartData;
        if (cart?.items) this.processCartData(cart, false, { skipPublish: true });
        else this.refreshCartState(false, { skipPublish: true });
      });
    },

    bindCartSummary() {
      const summary = document.querySelector('.karthika-floating-cart');
      document.addEventListener('karthika:cart-updated', (event) => {
        if (summary) this.renderCartSummary(event.detail, summary);
      });
      this.bindDawnCartSync();
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
      if (this._eventsBound) return;
      this._eventsBound = true;

      document.addEventListener('click', (e) => {
        const addBtn = e.target.closest('.karthika-stepper-add-btn');
        if (addBtn) {
          const stepper = addBtn.closest('.karthika-stepper');
          const variantId = stepper?.dataset?.variantId;
          const available = stepper?.dataset?.productAvailable !== 'false';
          if (variantId && available) {
            this.setQuantityOptimistic(variantId, (this.state.variantMap[Number(variantId)] || 0) + 1);
          } else if (!available) {
            this.showCartError(CART_UNAVAILABLE_ERROR);
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
            this.setQuantityOptimistic(vId, Math.max(0, currentQty - 1));
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
            this.setQuantityOptimistic(vId, currentQty + 1);
          }
          return;
        }

        const cartTrigger = e.target.closest(CART_TRIGGER_SELECTOR);
        if (cartTrigger) {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          this.openCartDrawer(cartTrigger);
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const cartTrigger = e.target.closest(CART_TRIGGER_SELECTOR);
        if (!cartTrigger) return;
        if (cartTrigger.tagName === 'A' || cartTrigger.tagName === 'BUTTON') {
          if (e.key === ' ') {
            e.preventDefault();
            this.openCartDrawer(cartTrigger);
          }
        }
      });
    }
  };

  /* --------------------------------------------------------------------------
     2. Location Selector Modal
     -------------------------------------------------------------------------- */
  const LocationManager = {
    STORAGE_KEY: 'karthika_delivery_location',
    _lastTrigger: null,
    _inertTargets: [],
    _onDocumentKeydown: null,

    init() {
      this._onDocumentKeydown = (event) => this.onDocumentKeydown(event);
      document.addEventListener('keydown', this._onDocumentKeydown, true);
      this.restore();

      document.addEventListener('click', (e) => {
        const trigger = e.target.closest('.karthika-change-location-btn');
        if (trigger) {
          e.preventDefault();
          this.open(trigger);
          return;
        }

        const dismiss = e.target.closest('[data-karthika-location-dismiss]');
        if (dismiss) {
          this.close();
          return;
        }

        const reset = e.target.closest('[data-karthika-location-reset]');
        if (reset) {
          e.preventDefault();
          this.resetToDefault();
          return;
        }

        const locationOption = e.target.closest('.karthika-location-item');
        if (locationOption && locationOption.closest('#KarthikaDeliveryModal')) {
          const id = locationOption.dataset.locationId;
          const label = (locationOption.dataset.label || locationOption.dataset.address || '').trim();
          if (label) this.setLocation({ id, label });
        }
      });
    },

    getModal() {
      return document.querySelector('#KarthikaDeliveryModal');
    },

    isSearchOpen() {
      return !!document.querySelector('#KarthikaSearchModal')?.classList.contains('is-open');
    },

    clearStoredLocation() {
      try {
        localStorage.removeItem(this.STORAGE_KEY);
      } catch (e) {}
    },

    defaultLocation() {
      const modal = this.getModal();
      if (!modal) return null;
      const label = (modal.getAttribute('data-default-location') || '').trim();
      if (!label) return null;
      return {
        id: (modal.getAttribute('data-default-location-id') || '').trim(),
        label,
      };
    },

    restore() {
      const modal = this.getModal();
      if (!modal) return;
      let stored = null;
      try {
        stored = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || 'null');
      } catch (e) {
        stored = null;
      }
      const validObject = stored && typeof stored === 'object' && !Array.isArray(stored);
      const id = validObject && typeof stored.id === 'string' && /^area-\d+$/.test(stored.id) ? stored.id : '';
      const match = id ? modal.querySelector(`.karthika-location-item[data-location-id="${id}"]`) : null;
      const matchLabel = match ? (match.dataset.label || match.dataset.address || '').trim() : '';
      if (matchLabel) {
        this.applyLocation({ id, label: matchLabel }, { persist: false, close: false });
        return;
      }
      if (localStorage.getItem(this.STORAGE_KEY)) this.clearStoredLocation();
      const fallback = this.defaultLocation();
      if (fallback) this.applyLocation(fallback, { persist: false, close: false });
    },

    resetToDefault() {
      this.clearStoredLocation();
      const fallback = this.defaultLocation();
      if (fallback) this.applyLocation(fallback, { persist: false, close: true });
      else this.close();
    },

    setLocation(location) {
      this.applyLocation(location, { persist: true, close: true });
    },

    applyLocation(location, options = {}) {
      const label = String(location?.label || '').trim();
      if (!label) return;

      document.querySelectorAll('.karthika-delivery-address').forEach((el) => {
        el.textContent = label;
      });

      document.querySelectorAll('#KarthikaDeliveryModal .karthika-location-item').forEach((item) => {
        const selected = item.dataset.locationId === location.id || item.dataset.label === label || item.dataset.address === label;
        item.classList.toggle('is-selected', selected);
        item.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });

      if (options.persist) {
        try {
          localStorage.setItem(
            this.STORAGE_KEY,
            JSON.stringify({
              id: String(location.id || ''),
              label,
            })
          );
        } catch (e) {}
      }

      if (options.close) this.close();
    },

    syncTriggerState(isOpen) {
      document.querySelectorAll('.karthika-change-location-btn').forEach((trigger) => {
        trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
    },

    getFocusable(container) {
      return Array.from(
        container.querySelectorAll(
          'a[href], button:not([disabled]):not(.karthika-delivery-modal-backdrop), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('hidden') && el.closest('[hidden]') == null);
    },

    setBackgroundInert(enable) {
      const modal = this.getModal();
      if (!enable) {
        this._inertTargets.forEach((el) => {
          el.removeAttribute('inert');
          if (el.dataset.karthikaLocationInertAria === '1') {
            el.removeAttribute('aria-hidden');
            delete el.dataset.karthikaLocationInertAria;
          }
        });
        this._inertTargets = [];
        return;
      }

      this._inertTargets = [];
      Array.from(document.body.children).forEach((el) => {
        if (el === modal || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
        el.setAttribute('inert', '');
        if (!el.hasAttribute('aria-hidden')) {
          el.setAttribute('aria-hidden', 'true');
          el.dataset.karthikaLocationInertAria = '1';
        }
        this._inertTargets.push(el);
      });
    },

    onDocumentKeydown(event) {
      if (this.isSearchOpen()) return;
      const modal = this.getModal();
      if (!modal || modal.hidden) return;

      if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault();
        this.close();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusables = this.getFocusable(modal);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },

    open(trigger) {
      const modal = this.getModal();
      if (!modal || this.isSearchOpen()) return;
      this._lastTrigger = trigger || document.activeElement;
      modal.hidden = false;
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('karthika-location-open');
      this.syncTriggerState(true);
      if (this._lastTrigger && typeof this._lastTrigger.blur === 'function') {
        this._lastTrigger.blur();
      }
      this.setBackgroundInert(true);
      window.requestAnimationFrame(() => {
        const selected =
          modal.querySelector('.karthika-location-item.is-selected') ||
          modal.querySelector('.karthika-delivery-modal-close:not(.karthika-delivery-modal-backdrop)');
        if (selected && typeof selected.focus === 'function') selected.focus();
      });
    },

    close(options = {}) {
      const modal = this.getModal();
      if (!modal) return;
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      modal.hidden = true;
      document.body.classList.remove('karthika-location-open');
      this.syncTriggerState(false);
      this.setBackgroundInert(false);
      const restore = this._lastTrigger;
      this._lastTrigger = null;
      if (options.restoreFocus !== false && restore && typeof restore.focus === 'function') {
        restore.focus();
      }
    }
  };

  /* --------------------------------------------------------------------------
     3. Search Modal Overlay
     -------------------------------------------------------------------------- */
  const SearchManager = {
    RECENT_KEY: 'karthika_recent_searches',
    MAX_RECENTS: 8,
    _lastTrigger: null,
    _inertTargets: [],
    _onDocumentKeydown: null,

    init() {
      this._onDocumentKeydown = (event) => this.onDocumentKeydown(event);
      document.addEventListener('keydown', this._onDocumentKeydown);

      document.addEventListener('click', (e) => {
        const trigger = e.target.closest('.karthika-search-bar-trigger, .karthika-nav-search-trigger');
        if (trigger) {
          e.preventDefault();
          this.open(trigger);
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

        const clearRecentBtn = e.target.closest('#karthikaClearRecentBtn');
        if (clearRecentBtn) {
          this.clearRecents();
          return;
        }

        const removeRecentBtn = e.target.closest('.karthika-recent-remove-btn');
        if (removeRecentBtn) {
          const query = removeRecentBtn.getAttribute('data-query');
          this.removeRecent(query);
          return;
        }

        const addBtn = e.target.closest('.karthika-need-card-add-btn');
        if (addBtn) {
          this.addRecommendedProduct(addBtn);
          return;
        }

        const collectionNav = e.target.closest(
          'a.karthika-cat-card, a.karthika-category-card, a.kcl-tile, a.karthika-quick-tab, a.kd-category, a.karthika-feature-card'
        );
        if (collectionNav) return;

        const searchChip = e.target.closest('.karthika-search-chip, .karthika-search-category, .karthika-recent-card-btn, .karthika-popular-icon-btn');
        if (searchChip) {
          if (searchChip.tagName === 'A') return;
          const query = searchChip.dataset.query;
          if (query) this.submitQuery(query);
        }
      });

      document.addEventListener('submit', (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || form.getAttribute('role') !== 'search') return;
        const input = form.querySelector('[name="q"]');
        this.saveRecent(input?.value);
      });

      document.addEventListener('input', (event) => {
        const input = event.target.closest('.karthika-search-modal-input, #Search-In-Template');
        if (!input) return;
        this.syncEmptyState();
        this.hideError();
        const pageError = document.querySelector('#KarthikaSearchPageError');
        if (pageError) {
          pageError.hidden = true;
          pageError.textContent = '';
        }
      });

      document.addEventListener('change', (event) => {
        if (!event.target.closest('facet-filters-form')) return;
        const pageError = document.querySelector('#KarthikaSearchPageError');
        if (pageError) {
          pageError.hidden = true;
          pageError.textContent = '';
        }
      });

      document.addEventListener('karthika:search-request-failed', (event) => {
        const source = event.detail?.source;
        if (source === 'predictive') {
          this.showError("We couldn't load suggestions. Check your connection and try again.");
        } else if (source === 'facets') {
          this.showPageError("We couldn't update those results. Check your connection and try again.");
        } else {
          this.showError("Search isn't available right now. Please try again.");
        }
      });

      this.renderRecents();
    },

    getRecents() {
      try {
        const parsed = JSON.parse(localStorage.getItem(this.RECENT_KEY) || '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed
          .map((item) => String(item || '').trim())
          .filter(Boolean)
          .slice(0, this.MAX_RECENTS);
      } catch (e) {
        return [];
      }
    },

    writeRecents(items) {
      try {
        localStorage.setItem(this.RECENT_KEY, JSON.stringify(items.slice(0, this.MAX_RECENTS)));
      } catch (e) {}
    },

    saveRecent(rawQuery) {
      const query = String(rawQuery || '').trim();
      if (!query) return;
      const next = [query, ...this.getRecents().filter((item) => item.toLowerCase() !== query.toLowerCase())];
      this.writeRecents(next);
      this.renderRecents();
    },

    removeRecent(rawQuery) {
      const query = String(rawQuery || '').trim();
      if (!query) return;
      this.writeRecents(this.getRecents().filter((item) => item.toLowerCase() !== query.toLowerCase()));
      this.renderRecents();
    },

    clearRecents() {
      try {
        localStorage.removeItem(this.RECENT_KEY);
      } catch (e) {}
      this.renderRecents();
    },

    renderRecents() {
      const group = document.querySelector('#karthikaRecentSearchesGroup');
      const row = document.querySelector('#karthikaRecentCardsRow');
      if (!group || !row) return;

      const recents = this.getRecents();
      row.replaceChildren();

      if (!recents.length) {
        group.hidden = true;
        return;
      }

      recents.forEach((query) => {
        const card = document.createElement('div');
        card.className = 'karthika-recent-card';
        card.dataset.query = query;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'karthika-recent-remove-btn';
        removeBtn.setAttribute('data-query', query);
        removeBtn.setAttribute('aria-label', `Remove ${query}`);
        removeBtn.textContent = '×';

        const searchBtn = document.createElement('button');
        searchBtn.type = 'button';
        searchBtn.className = 'karthika-recent-card-btn';
        searchBtn.dataset.query = query;

        const mark = document.createElement('span');
        mark.className = 'karthika-recent-card-mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = query.slice(0, 1).toUpperCase();

        const name = document.createElement('span');
        name.className = 'karthika-recent-card-name';
        name.textContent = query;

        searchBtn.append(mark, name);
        card.append(removeBtn, searchBtn);
        row.append(card);
      });

      group.hidden = false;
    },

    submitQuery(query) {
      const input = document.querySelector('#KarthikaSearchModalInput, .karthika-search-modal-input');
      if (!input) return;
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      this.saveRecent(query);
      input.closest('form')?.requestSubmit();
    },

    async addRecommendedProduct(button) {
      if (button.disabled || button.getAttribute('aria-busy') === 'true') return;
      const variantId = button.getAttribute('data-variant-id');
      if (!variantId || !window.Karthika?.Cart?.addNow) {
        this.showError("We couldn't add that item. Please try again.");
        return;
      }

      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.classList.remove('is-added', 'is-error');

      const result = await window.Karthika.Cart.addNow(variantId, 1);

      button.disabled = false;
      button.removeAttribute('aria-busy');

      if (!result?.ok) {
        if (result?.reason === 'pending') return;
        button.classList.add('is-error');
        this.showError(result?.message || "We couldn't add that item. Please try again.");
        return;
      }

      button.classList.add('is-added');
      this.hideError();
    },

    showError(message) {
      const errorEl = document.querySelector('#KarthikaSearchModalError');
      if (!errorEl) return;
      errorEl.textContent = message;
      errorEl.hidden = false;
    },

    hideError() {
      const errorEl = document.querySelector('#KarthikaSearchModalError');
      if (!errorEl) return;
      errorEl.textContent = '';
      errorEl.hidden = true;
    },

    showPageError(message) {
      const errorEl = document.querySelector('#KarthikaSearchPageError');
      if (!errorEl) {
        this.showError(message);
        return;
      }
      errorEl.textContent = message;
      errorEl.hidden = false;
    },

    syncEmptyState() {
      const modal = document.querySelector('#KarthikaSearchModal');
      if (!modal) return;
      const input = modal.querySelector('.karthika-search-modal-input');
      const hasQuery = !!(input && input.value.trim().length > 0);
      modal.classList.toggle('has-query', hasQuery);

      this.syncTriggerState(modal.classList.contains('is-open'));
    },

    syncTriggerState(isOpen) {
      document.querySelectorAll('.karthika-search-bar-trigger, .karthika-nav-search-trigger').forEach((trigger) => {
        trigger.classList.toggle('is-open', isOpen);
        trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
    },

    getFocusable(container) {
      return Array.from(
        container.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('hidden') && el.closest('[hidden]') == null);
    },

    setBackgroundInert(enable) {
      const modal = document.querySelector('#KarthikaSearchModal');
      if (!enable) {
        this._inertTargets.forEach((el) => {
          el.removeAttribute('inert');
          if (el.dataset.karthikaInertAria === '1') {
            el.removeAttribute('aria-hidden');
            delete el.dataset.karthikaInertAria;
          }
        });
        this._inertTargets = [];
        return;
      }

      this._inertTargets = [];
      Array.from(document.body.children).forEach((el) => {
        if (el === modal || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
        el.setAttribute('inert', '');
        if (!el.hasAttribute('aria-hidden')) {
          el.setAttribute('aria-hidden', 'true');
          el.dataset.karthikaInertAria = '1';
        }
        this._inertTargets.push(el);
      });
    },

    onDocumentKeydown(event) {
      const modal = document.querySelector('#KarthikaSearchModal');
      if (!modal?.classList.contains('is-open')) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusables = this.getFocusable(modal);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },

    open(trigger) {
      const modal = document.querySelector('#KarthikaSearchModal');
      if (!modal) return;
      this._lastTrigger = trigger || document.activeElement;
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('karthika-search-open');
      this.setBackgroundInert(true);
      this.renderRecents();
      this.syncEmptyState();
      window.requestAnimationFrame(() => {
        modal.querySelector('.karthika-search-modal-input')?.focus();
      });
    },

    close(options = {}) {
      const modal = document.querySelector('#KarthikaSearchModal');
      if (!modal) return;
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('karthika-search-open');
      this.setBackgroundInert(false);
      this.syncEmptyState();
      this.hideError();
      const trigger = this._lastTrigger;
      this._lastTrigger = null;
      if (options.restoreFocus !== false && trigger && typeof trigger.focus === 'function') {
        trigger.focus();
      }
    }
  };

  /* --------------------------------------------------------------------------
     4. Shopping Assistant (manual) + optional AI App Proxy
     -------------------------------------------------------------------------- */
  const ShoppingAssistantManager = {
    _root: null,
    _busy: false,

    init() {
      this._root = document.querySelector('[data-karthika-assistant]');
      if (!this._root) return;

      this._root.addEventListener('click', (event) => {
        const opener = event.target.closest('[data-assistant-open]');
        if (opener && this._root.contains(opener)) {
          event.preventDefault();
          this.openView(opener.getAttribute('data-assistant-open'), opener);
          return;
        }
        const back = event.target.closest('[data-assistant-back]');
        if (back && this._root.contains(back)) {
          event.preventDefault();
          this.openView('home');
          return;
        }
        const bulk = event.target.closest('[data-assistant-bulk]');
        if (bulk && this._root.contains(bulk)) {
          event.preventDefault();
          this.addAvailableFromPanel(bulk);
        }
      });

      this._root.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const home = this._root.querySelector('[data-assistant-view="home"]');
        if (home && !home.hidden) return;
        this.openView('home');
      });

      const suggestForm = this._root.querySelector('[data-assistant-suggest-form]');
      if (suggestForm) {
        suggestForm.addEventListener('submit', (event) => {
          event.preventDefault();
          const hint = this._root.querySelector('[data-assistant-hint]');
          if (hint) hint.hidden = false;
          this.announce('Try one of the category, need, or recipe options below.');
          const firstChip = this._root.querySelector('[data-assistant-view="home"] [data-assistant-open]');
          if (firstChip) firstChip.focus();
        });
      }
    },

    announce(message) {
      const live = this._root?.querySelector('[data-assistant-live]');
      if (!live) return;
      live.textContent = '';
      window.requestAnimationFrame(() => {
        live.textContent = message;
      });
    },

    openView(viewId, trigger) {
      if (!viewId || !this._root) return;
      const views = this._root.querySelectorAll('[data-assistant-view]');
      let shown = null;
      views.forEach((view) => {
        const match = view.getAttribute('data-assistant-view') === viewId;
        view.hidden = !match;
        if (match) shown = view;
      });

      this._root.querySelectorAll('[data-assistant-open]').forEach((btn) => {
        const expanded = btn.getAttribute('data-assistant-open') === viewId;
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        btn.classList.toggle('is-active', expanded);
      });

      if (shown) {
        const heading = shown.querySelector('.karthika-assistant-panel-title, .karthika-ai-title');
        if (heading) {
          heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: false });
        }
        shown.scrollIntoView({ block: 'nearest' });
      } else if (trigger) {
        trigger.focus();
      }
    },

    collectAvailableVariants(panel) {
      const cards = panel.querySelectorAll('.karthika-compact-card[data-variant-id]');
      const items = [];
      const seen = new Set();
      cards.forEach((card) => {
        const variantId = Number(card.getAttribute('data-variant-id'));
        if (!variantId || seen.has(variantId)) return;
        const stepper = card.querySelector('.karthika-stepper[data-product-available="true"]');
        if (!stepper) return;
        seen.add(variantId);
        items.push({ id: variantId, quantity: 1 });
      });
      return items;
    },

    summarizeAdd(added, failed) {
      if (added > 0 && failed > 0) {
        return failed === 1
          ? `${added} items added. 1 item could not be added.`
          : `${added} items added. ${failed} item could not be added.`;
      }
      if (added === 1 && failed === 0) return '1 item added.';
      if (added > 1 && failed === 0) return `${added} items added.`;
      return 'No items could be added.';
    },

    async addAvailableFromPanel(button) {
      if (this._busy) return;
      const panel = button.closest('[data-assistant-view]');
      if (!panel || !window.Karthika?.Cart?.addMany) return;

      const items = this.collectAvailableVariants(panel);
      if (!items.length) {
        this.announce('No available ingredients to add.');
        window.Karthika.Cart.showCartError('No available ingredients to add.');
        return;
      }

      this._busy = true;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = 'Adding items…';

      try {
        const result = await window.Karthika.Cart.addMany(items);
        const message = this.summarizeAdd(result.added, result.failed);
        this.announce(message);
        if (result.failed > 0) {
          window.Karthika.Cart.showCartError(message);
        } else {
          window.Karthika.Cart.announce(message);
        }
        if (result.added > 0) {
          window.Karthika.Cart.openCartDrawer(button);
        }
      } finally {
        this._busy = false;
        button.disabled = false;
        button.textContent = original;
      }
    }
  };

  const AIAssistantManager = {
    _isLoading: false,
    _requestSeq: 0,
    _matchedProducts: [],
    _abort: null,
    MAX_QUERY: 200,
    TIMEOUT_MS: 20000,

    isEnabled() {
      const root = document.querySelector('[data-karthika-assistant][data-karthika-ai-enabled="true"]');
      return Boolean(root);
    },

    getRoot() {
      return document.querySelector('[data-karthika-assistant][data-karthika-ai-enabled="true"]');
    },

    getProxyUrl() {
      const root = this.getRoot();
      return root?.getAttribute('data-ai-endpoint') || '/apps/karthika/recommend';
    },

    escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },

    parseResponse(text) {
      if (!text || typeof text !== 'string') return null;
      const trimmed = text.trim();
      try {
        return JSON.parse(trimmed);
      } catch (err) {
        const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced) {
          try {
            return JSON.parse(fenced[1].trim());
          } catch (err2) {
            return null;
          }
        }
        return null;
      }
    },

    sanitizeMatched(list) {
      if (!Array.isArray(list)) return [];
      const out = [];
      list.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        let rawId = item.variantId || item.variant_id || item.id;
        if (typeof rawId === 'string' && rawId.includes('/')) {
          rawId = rawId.split('/').pop();
        }
        const variantId = Number(rawId);
        if (!Number.isInteger(variantId) || variantId <= 0) return;
        const qty = Number(item.qty || item.quantity || 1);
        out.push({
          variantId,
          qty: qty > 0 && qty < 100 ? qty : 1,
          title: typeof item.title === 'string' ? item.title : 'Store item',
          image: typeof item.image === 'string' && item.image.startsWith('https://') ? item.image : '',
          handle: typeof item.handle === 'string' ? item.handle : '',
        });
      });
      return out;
    },

    setState(state, message) {
      const root = this.getRoot();
      if (!root) return;
      const submitBtn = root.querySelector('[data-karthika-ai-submit]');
      const basketEl = root.querySelector('[data-karthika-ai-basket]');
      const errorEl = root.querySelector('[data-karthika-ai-error]');
      const live = root.querySelector('[data-assistant-live]');

      this._isLoading = state === 'loading';
      if (submitBtn) submitBtn.disabled = this._isLoading;
      if (basketEl) basketEl.classList.toggle('is-ai-loading', this._isLoading);
      if (errorEl) {
        errorEl.hidden = state !== 'error';
        if (state === 'error' && message) errorEl.textContent = message;
      }
      if (live && message) {
        live.textContent = '';
        window.requestAnimationFrame(() => {
          live.textContent = message;
        });
      }
    },

    customerError(status) {
      if (status === 401 || status === 403) {
        return 'Sorry, the assistant is unavailable right now. Please try again, or shop by category below.';
      }
      if (status === 429) {
        return 'Sorry, the assistant is unavailable right now. Please try again, or shop by category below.';
      }
      return 'Sorry, the assistant is unavailable right now. Please try again, or shop by category below.';
    },

    renderRecommendation(data) {
      const root = this.getRoot();
      if (!root || !data) return;
      const titleEl = root.querySelector('[data-karthika-ai-title]');
      const countEl = root.querySelector('[data-karthika-ai-count]');
      const listEl = root.querySelector('[data-karthika-ai-list]');
      const buildBtn = root.querySelector('[data-karthika-ai-add]');
      const basketEl = root.querySelector('[data-karthika-ai-basket]');
      const matched = this.sanitizeMatched(data.matched);
      const unmatched = Array.isArray(data.unmatched)
        ? data.unmatched.filter((name) => typeof name === 'string' && name.trim())
        : [];
      this._matchedProducts = matched;

      if (basketEl) basketEl.hidden = false;
      if (titleEl) titleEl.textContent = data.dishName || 'Recommended for you';
      if (countEl) {
        countEl.textContent = matched.length
          ? `${matched.length} store item${matched.length === 1 ? '' : 's'}`
          : 'No matching products in this store.';
      }
      if (listEl) {
        const rows = matched.map((item) => {
          const thumb = item.image
            ? `<img src="${this.escapeHtml(item.image)}" alt="" class="karthika-ai-item-thumb" width="44" height="44" loading="lazy">`
            : '<div class="karthika-ai-item-thumb karthika-compact-media-placeholder" aria-hidden="true"></div>';
          const href = item.handle ? `/products/${encodeURIComponent(item.handle)}` : '';
          const name = href
            ? `<a href="${href}">${this.escapeHtml(item.title)}</a>`
            : this.escapeHtml(item.title);
          return `<div class="karthika-ai-item-row">${thumb}<div class="karthika-ai-item-info"><span class="karthika-ai-item-name">${name}</span></div></div>`;
        }).join('');
        const missing = unmatched.length
          ? `<div class="karthika-ai-item-row"><div class="karthika-ai-item-info"><span class="karthika-ai-item-name">Some ingredients are not available in this store.</span><span class="karthika-ai-item-tag">${this.escapeHtml(unmatched.join(', '))}</span></div></div>`
          : '';
        listEl.innerHTML = rows || missing || '<p class="karthika-assistant-empty">No matching products in this store.</p>';
      }
      if (buildBtn) {
        buildBtn.disabled = matched.length === 0;
        buildBtn.textContent = matched.length
          ? `Add available items (${matched.length})`
          : 'Items not available in store';
      }
    },

    async sendRecommendationRequest(payload) {
      if (!this.isEnabled() || this._isLoading) return;
      const query = String(payload.query || payload.dishName || '').trim().slice(0, this.MAX_QUERY);
      if (!query) {
        this.setState('error', 'Enter a short question or tap a suggestion.');
        return;
      }

      if (this._abort) this._abort.abort();
      this._abort = new AbortController();
      const requestId = ++this._requestSeq;
      this._matchedProducts = [];
      this.setState('loading', 'Looking up store items…');

      const root = this.getRoot();
      const listEl = root?.querySelector('[data-karthika-ai-list]');
      const basketEl = root?.querySelector('[data-karthika-ai-basket]');
      if (basketEl) basketEl.hidden = false;
      if (listEl) {
        listEl.innerHTML = '<p class="karthika-assistant-empty" role="status">Looking up store items…</p>';
      }

      const timer = window.setTimeout(() => this._abort.abort(), this.TIMEOUT_MS);

      try {
        const response = await fetch(this.getProxyUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            type: payload.type || 'text',
            query,
            dishName: payload.dishName || query,
          }),
          signal: this._abort.signal,
        });

        const raw = await response.text();
        if (requestId !== this._requestSeq) return;

        if (!response.ok) {
          this.setState('error', this.customerError(response.status));
          return;
        }

        const data = this.parseResponse(raw);
        if (!data || typeof data !== 'object') {
          this.setState('error', this.customerError(0));
          return;
        }

        if (data.fallback || data.error) {
          this.setState('error', this.customerError(0));
          return;
        }

        this.setState('success', 'Recommendations ready.');
        this.renderRecommendation(data);
      } catch (err) {
        if (requestId !== this._requestSeq) return;
        this.setState('error', this.customerError(0));
      } finally {
        window.clearTimeout(timer);
        if (requestId === this._requestSeq) {
          this._isLoading = false;
          const submitBtn = this.getRoot()?.querySelector('[data-karthika-ai-submit]');
          if (submitBtn) submitBtn.disabled = false;
        }
      }
    },

    async buildAndAddBasket(btn) {
      if (!window.Karthika?.Cart?.addMany) return;
      const items = (this._matchedProducts || [])
        .map((item) => ({ id: item.variantId, quantity: item.qty || 1 }))
        .filter((item) => item.id);
      if (!items.length) {
        this.setState('error', 'That product is currently unavailable.');
        return;
      }

      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Adding items…';
      try {
        const result = await window.Karthika.Cart.addMany(items);
        const failed = result.failed;
        const added = result.added;
        let message = 'No items could be added.';
        if (added > 0 && failed > 0) {
          message = failed === 1
            ? `${added} items added. 1 item could not be added.`
            : `${added} items added. ${failed} item could not be added.`;
        } else if (added === 1) {
          message = '1 item added.';
        } else if (added > 1) {
          message = `${added} items added.`;
        }
        this.setState(failed ? 'error' : 'success', message);
        if (failed) window.Karthika.Cart.showCartError(message);
        if (added > 0) window.Karthika.Cart.openCartDrawer(btn);
      } finally {
        btn.disabled = items.length === 0;
        btn.textContent = original;
      }
    },

    init() {
      const root = this.getRoot();
      if (!root) return;

      const form = root.querySelector('[data-karthika-ai-form]');
      if (form) {
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          if (this._isLoading) return;
          const input = form.querySelector('.karthika-ai-input');
          const query = input ? input.value.trim() : '';
          this.sendRecommendationRequest({ type: 'text', query });
        });
      }

      root.addEventListener('click', (event) => {
        const addBtn = event.target.closest('[data-karthika-ai-add]');
        if (!addBtn || addBtn.disabled) return;
        this.buildAndAddBasket(addBtn);
      });
    }
  };

  /* --------------------------------------------------------------------------
     5. Search Placeholder Rotator
     Rotates the search bar placeholder text through popular product names.
     Terms are sourced from data-search-terms on the .karthika-search-bar-trigger
     element so they can be updated in Liquid without touching JS.
     -------------------------------------------------------------------------- */
  const SearchPlaceholderRotator = {
    _states: [],
    _INTERVAL: 3500,
    _FADE: 380,

    init() {
      this.destroy();
      document.querySelectorAll('.karthika-search-placeholder-host[data-search-terms]').forEach((host) => {
        this._bindHost(host);
      });
    },

    destroy() {
      this._states.forEach((state) => clearTimeout(state.timer));
      this._states = [];
    },

    _bindHost(host) {
      const raw = host.getAttribute('data-search-terms') || '';
      const terms = raw.split('|').map((t) => t.trim()).filter(Boolean);
      if (terms.length < 2) return;

      const target = host.querySelector('.karthika-search-placeholder-target');
      if (!target) return;

      const state = {
        host,
        target,
        terms,
        index: Math.floor(Math.random() * terms.length),
        timer: null,
      };

      this._states.push(state);
      this._applyTerm(state, state.terms[state.index], false);
      this._schedule(state);
    },

    _schedule(state) {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => this._rotate(state), this._INTERVAL);
    },

    _rotate(state) {
      const modal = document.querySelector('#KarthikaSearchModal');
      if (modal?.classList.contains('is-open')) {
        this._schedule(state);
        return;
      }

      state.index = (state.index + 1) % state.terms.length;
      this._applyTerm(state, state.terms[state.index], true);
      this._schedule(state);
    },

    _applyTerm(state, term, animate) {
      if (!animate) {
        state.target.textContent = term;
        return;
      }

      state.target.style.transition = 'opacity ' + this._FADE + 'ms ease';
      state.target.style.opacity = '0';
      setTimeout(() => {
        state.target.textContent = term;
        state.target.style.opacity = '1';
      }, this._FADE);
    }
  };

  /* --------------------------------------------------------------------------
     Wishlist — localStorage identifiers only; product data from Shopify
     -------------------------------------------------------------------------- */
  const WISHLIST_EVENT = 'karthika:wishlist-updated';

  const WishlistManager = {
    STORAGE_KEY: 'karthika_wishlist',
    items: [],
    _eventsBound: false,
    _observer: null,
    _syncTimer: null,
    _pageRoot: null,
    _pageLoaded: false,
    _pageLoading: false,

    shopRoot() {
      const root = window.Shopify?.routes?.root || window.routes?.root || '/';
      return root.endsWith('/') ? root : `${root}/`;
    },

    sanitizeHandle(value) {
      if (value == null) return '';
      const handle = String(value).trim().toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)) return '';
      if (handle.length > 255) return '';
      return handle;
    },

    load() {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (!raw) {
          this.items = [];
          return this.items;
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          this.items = [];
          return this.items;
        }
        const seen = new Set();
        const next = [];
        parsed.forEach((entry) => {
          const handle = this.sanitizeHandle(entry);
          if (handle && !seen.has(handle)) {
            seen.add(handle);
            next.push(handle);
          }
        });
        this.items = next;
        return this.items;
      } catch (e) {
        this.items = [];
        return this.items;
      }
    },

    persist() {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.items));
      } catch (e) {
        /* private mode / quota */
      }
    },

    save() {
      this.persist();
      this.notify();
    },

    notify() {
      document.dispatchEvent(
        new CustomEvent(WISHLIST_EVENT, {
          detail: { items: this.items.slice(), count: this.count() },
        })
      );
      this.syncButtons();
      this.syncCounts();
      this.syncPageAfterChange();
    },

    contains(handle) {
      const safe = this.sanitizeHandle(handle);
      return safe ? this.items.indexOf(safe) !== -1 : false;
    },

    add(handle) {
      const safe = this.sanitizeHandle(handle);
      if (!safe) return false;
      if (this.contains(safe)) return false;
      this.items.push(safe);
      this.save();
      return true;
    },

    remove(handle) {
      const safe = this.sanitizeHandle(handle);
      if (!safe) return false;
      const next = this.items.filter((item) => item !== safe);
      if (next.length === this.items.length) return false;
      this.items = next;
      this.save();
      return true;
    },

    toggle(handle) {
      const safe = this.sanitizeHandle(handle);
      if (!safe) return false;
      if (this.contains(safe)) {
        this.remove(safe);
        return false;
      }
      this.add(safe);
      return true;
    },

    clear() {
      this.items = [];
      this.save();
    },

    count() {
      return this.items.length;
    },

    applyButtonState(button, saved) {
      if (!(button instanceof HTMLElement)) return;
      button.classList.toggle('is-wishlisted', saved);
      button.setAttribute('aria-pressed', saved ? 'true' : 'false');
      const addLabel = button.getAttribute('data-label-add');
      const removeLabel = button.getAttribute('data-label-remove');
      const label = saved ? removeLabel : addLabel;
      if (label) button.setAttribute('aria-label', label);
    },

    syncButtons(root) {
      const scope = root instanceof Element ? root : document;
      scope.querySelectorAll('.karthika-wishlist-btn[data-product-handle]').forEach((button) => {
        const handle = this.sanitizeHandle(button.getAttribute('data-product-handle'));
        this.applyButtonState(button, this.contains(handle));
      });
    },

    syncCounts() {
      const count = String(this.count());
      document.querySelectorAll('[data-wishlist-count]').forEach((el) => {
        el.textContent = count;
        if (el.hasAttribute('data-wishlist-count-hide-empty')) {
          el.hidden = this.count() === 0;
        }
      });
    },

    queueSync() {
      clearTimeout(this._syncTimer);
      this._syncTimer = setTimeout(() => this.syncButtons(), 50);
    },

    bindEvents() {
      if (this._eventsBound) return;
      this._eventsBound = true;

      document.addEventListener(
        'click',
        (event) => {
          const button = event.target.closest('.karthika-wishlist-btn');
          if (!button) return;
          event.preventDefault();
          event.stopPropagation();
          const handle = this.sanitizeHandle(button.getAttribute('data-product-handle'));
          if (!handle) return;
          this.toggle(handle);
        },
        true
      );

      window.addEventListener('storage', (event) => {
        if (event.key !== this.STORAGE_KEY) return;
        this.load();
        document.dispatchEvent(
          new CustomEvent(WISHLIST_EVENT, {
            detail: { items: this.items.slice(), count: this.count() },
          })
        );
        this.syncButtons();
        this.syncCounts();
        if (this._pageRoot) {
          this._pageLoaded = false;
          this.loadPage();
        }
      });

      if (typeof MutationObserver !== 'undefined') {
        this._observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (!(node instanceof Element)) continue;
              if (node.matches('.karthika-wishlist-btn') || node.querySelector('.karthika-wishlist-btn')) {
                this.queueSync();
                return;
              }
            }
          }
        });
        this._observer.observe(document.body, { childList: true, subtree: true });
      }
    },

    cardUrl(handle) {
      const view = this._pageRoot?.getAttribute('data-card-view') || 'wishlist-card';
      return `${this.shopRoot()}products/${encodeURIComponent(handle)}?view=${encodeURIComponent(view)}`;
    },

    async fetchCard(handle) {
      const safe = this.sanitizeHandle(handle);
      if (!safe) return { handle: '', card: null, missing: true };
      try {
        const response = await fetch(this.cardUrl(safe), {
          credentials: 'same-origin',
          headers: { Accept: 'text/html' },
        });
        if (response.status === 404) return { handle: safe, card: null, missing: true };
        if (!response.ok) return { handle: safe, card: null, missing: false, error: true };
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const card = doc.querySelector('.karthika-compact-card');
        if (!card) return { handle: safe, card: null, missing: true };
        return { handle: safe, card: document.importNode(card, true), missing: false };
      } catch (e) {
        return { handle: safe, card: null, missing: false, error: true };
      }
    },

    setPageMode(mode) {
      if (!this._pageRoot) return;
      const loading = this._pageRoot.querySelector('[data-wishlist-loading]');
      const empty = this._pageRoot.querySelector('[data-wishlist-empty]');
      const grid = this._pageRoot.querySelector('[data-wishlist-grid]');
      if (loading) loading.hidden = mode !== 'loading';
      if (empty) empty.hidden = mode !== 'empty';
      if (grid) grid.hidden = mode !== 'grid';
    },

    async loadPage() {
      if (!this._pageRoot || this._pageLoading) return;
      this._pageLoading = true;
      const grid = this._pageRoot.querySelector('[data-wishlist-grid]');
      const status = this._pageRoot.querySelector('[data-wishlist-status]');
      if (!grid) {
        this._pageLoading = false;
        return;
      }

      const handles = this.items.slice();
      if (!handles.length) {
        grid.replaceChildren();
        this.setPageMode('empty');
        this._pageLoaded = true;
        this._pageLoading = false;
        return;
      }

      this.setPageMode('loading');
      const results = await Promise.all(handles.map((handle) => this.fetchCard(handle)));
      const keptHandles = [];
      const cards = [];
      let removedMissing = false;
      let hadError = false;

      results.forEach((result, index) => {
        const handle = handles[index];
        if (result?.card) {
          keptHandles.push(handle);
          cards.push(result.card);
          return;
        }
        if (result?.missing) {
          removedMissing = true;
          return;
        }
        hadError = true;
        keptHandles.push(handle);
      });

      if (removedMissing) {
        this.items = keptHandles;
        this.persist();
        document.dispatchEvent(
          new CustomEvent(WISHLIST_EVENT, {
            detail: { items: this.items.slice(), count: this.count() },
          })
        );
        this.syncButtons();
        this.syncCounts();
      }

      if (status) {
        if (removedMissing) {
          status.hidden = false;
          status.textContent = status.getAttribute('data-unavailable-message') || '';
        } else if (hadError && !cards.length) {
          status.hidden = false;
          status.textContent = status.getAttribute('data-load-error-message') || '';
        } else {
          status.hidden = true;
          status.textContent = '';
        }
      }

      grid.replaceChildren();
      cards.forEach((card) => grid.appendChild(card));
      this.syncButtons(grid);
      if (window.Karthika?.Cart?.syncAllSteppers) {
        window.Karthika.Cart.syncAllSteppers();
      }

      this.setPageMode(cards.length ? 'grid' : 'empty');
      this._pageLoaded = true;
      this._pageLoading = false;
    },

    syncPageAfterChange() {
      if (!this._pageRoot || !this._pageLoaded || this._pageLoading) return;
      const grid = this._pageRoot.querySelector('[data-wishlist-grid]');
      if (!grid) return;

      grid.querySelectorAll('.karthika-compact-card').forEach((card) => {
        const handle = this.sanitizeHandle(card.getAttribute('data-product-handle'));
        if (!this.contains(handle)) card.remove();
      });

      if (!this.items.length) {
        this.setPageMode('empty');
        return;
      }

      const rendered = new Set();
      grid.querySelectorAll('.karthika-compact-card').forEach((card) => {
        const handle = this.sanitizeHandle(card.getAttribute('data-product-handle'));
        if (handle) rendered.add(handle);
      });

      const needsFetch = this.items.some((handle) => !rendered.has(handle));
      if (needsFetch) {
        this.loadPage();
        return;
      }

      this.setPageMode('grid');
    },

    init() {
      this.load();
      this.bindEvents();
      this.syncButtons();
      this.syncCounts();
      this._pageRoot = document.querySelector('[data-karthika-wishlist-page]');
      if (this._pageRoot) {
        this.loadPage();
      }
    },
  };

  // Expose on global object
  window.Karthika.Cart = CartManager;
  window.Karthika.Location = LocationManager;
  window.Karthika.Search = SearchManager;
  window.Karthika.ShoppingAssistant = ShoppingAssistantManager;
  window.Karthika.AI = AIAssistantManager;
  window.Karthika.SearchPlaceholder = SearchPlaceholderRotator;
  window.Karthika.Wishlist = WishlistManager;

  // Initialize all managers on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    CartManager.init();
    LocationManager.init();
    SearchManager.init();
    ShoppingAssistantManager.init();
    AIAssistantManager.init();
    SearchPlaceholderRotator.init();
    WishlistManager.init();
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
        this.backBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.close();
        });
      }

      document.addEventListener('keydown', (e) => {
        if (!this.isOpen()) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
          return;
        }
        if (e.key === 'Tab') this.trapFocus(e);
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
    },

    trapFocus(event) {
      if (!this.overlay) return;
      const focusable = Array.from(
        this.overlay.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
        )
      ).filter((el) => !el.hasAttribute('hidden') && el.offsetParent !== null);
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
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    AccountScreen.init();
  });
})();

(function () {
  'use strict';

  document.addEventListener('click', function (e) {
    var logout = e.target.closest('a[href*="/account/logout"], a[href*="/account/logout/"]');
    if (!logout) return;
    try {
      sessionStorage.removeItem('karthikaReturnHome');
      sessionStorage.removeItem('karthikaAccountTab');
    } catch (err) {}
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

      this.root.addEventListener('keydown', (event) => {
        const tab = event.target.closest('[role="tab"][data-kap-tab]');
        if (!tab) return;
        const tabs = [...this.root.querySelectorAll('[role="tab"][data-kap-tab]')];
        const index = tabs.indexOf(tab);
        if (index < 0) return;
        let next = -1;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (next < 0) return;
        event.preventDefault();
        tabs[next].focus();
        this.showTab(tabs[next].dataset.kapTab, false);
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
        tab.tabIndex = isMatch ? 0 : -1;
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
        label.textContent = window.karthikaAccountStrings?.buyAgainUnavailable || 'Unavailable';
        setTimeout(() => {
          label.textContent = originalText;
        }, 2000);
        return;
      }

      btn.disabled = true;
      label.textContent = window.karthikaAccountStrings?.buyAgainAdding || 'Adding\u2026';
      let lastError = '';

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

          let payload = null;
          try {
            payload = await res.json();
          } catch (err) {}
          if (res.ok) {
            successCount++;
            if (payload?.key) addedKeysNewestFirst.unshift(payload.key);
          } else if (payload && (payload.description || payload.message)) {
            lastError = String(payload.description || payload.message).slice(0, 180);
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
        label.textContent = lastError || window.karthikaAccountStrings?.buyAgainRetry || 'Try again';
        setTimeout(() => {
          label.textContent = originalText;
        }, 2800);
        return;
      }

      btn.classList.add('is-done');
      const addedTpl = window.karthikaAccountStrings?.buyAgainAdded || '[count] added';
      label.textContent = addedTpl.replace('[count]', String(successCount));

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