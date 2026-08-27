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
        cart.items.forEach((item) => {
          if (item.quantity > (this.state.variantMap[item.variant_id] || 0)) {
            updatedIds.push(item.variant_id);
          }
        });
        recents = recents.filter(id => !updatedIds.includes(id));
        recents = [...updatedIds, ...recents];
      }

      const cartVariantIds = cart.items.map(i => i.variant_id);
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

    async add(variantId, quantity = 1, openDrawer = false) {
      try {
        const formData = new FormData();
        formData.append('id', Number(variantId));
        formData.append('quantity', Number(quantity));

        const response = await fetch(this.getCartEndpoint('cart/add'), {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          alert(errData?.description || 'Could not add item to cart.');
          return;
        }

        await this.refreshCartState();

        if (openDrawer) {
          this.openCartDrawer();
        }
      } catch (err) {
        console.error('[Karthika Cart] Add error:', err);
        alert('Unable to add this product to the cart right now. Please try again.');
      }
    },

    async change(variantId, quantity) {
      try {
        const nextQty = Number(quantity);
        const response = await fetch(this.getCartEndpoint('cart/change'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: String(variantId), quantity: nextQty })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          console.warn('[Karthika Cart] Change rejected:', errData);
          return;
        }

        await this.refreshCartState();
      } catch (err) {
        console.error('[Karthika Cart] Change error:', err);
      }
    },

    openCartDrawer() {
      const cartUrl = window.routes?.cart_url || '/cart';
      const cartPage = document.body?.classList.contains('template-cart');

      if (cartPage) return;

      const drawer = document.querySelector('cart-drawer') || document.querySelector('#CartDrawer');
      if (drawer && typeof drawer.open === 'function' && window.location.pathname !== cartUrl) {
        drawer.open();
      } else {
        window.location.href = cartUrl;
      }
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
      document.addEventListener('click', async (e) => {
        const addBtn = e.target.closest('.karthika-stepper-add-btn');
        if (addBtn) {
          const stepper = addBtn.closest('.karthika-stepper');
          const variantId = stepper?.dataset?.variantId;
          if (variantId) {
            await this.add(variantId, 1, false);
          }
          return;
        }

        const minusBtn = e.target.closest('.karthika-stepper-btn--minus');
        if (minusBtn) {
          const stepper = minusBtn.closest('.karthika-stepper');
          const variantId = stepper?.dataset?.variantId;
          const qtyEl = stepper.querySelector('.karthika-stepper-qty');
          const currentQty = parseInt(qtyEl?.textContent || '1', 10);

          if (variantId) {
            const nextQty = Math.max(0, currentQty - 1);
            if (nextQty === 0) {
              await this.change(variantId, 0);
            } else {
              await this.change(variantId, nextQty);
            }
          }
          return;
        }

        const plusBtn = e.target.closest('.karthika-stepper-btn--plus');
        if (plusBtn) {
          const stepper = plusBtn.closest('.karthika-stepper');
          const variantId = stepper?.dataset?.variantId;
          const qtyEl = stepper.querySelector('.karthika-stepper-qty');
          const currentQty = parseInt(qtyEl?.textContent || '1', 10);

          if (variantId) {
            const nextQty = currentQty + 1;
            const cartQty = this.state.variantMap[variantId] || 0;
            if (cartQty > 0) {
              await this.change(variantId, nextQty);
            } else {
              await this.add(variantId, nextQty, false);
            }
          }
          return;
        }

        const cartTrigger = e.target.closest('.karthika-cart-trigger');
        if (cartTrigger) {
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

        const searchChip = e.target.closest('.karthika-search-chip, .karthika-search-category');
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
    init() {
      document.addEventListener('click', (e) => {
        const pill = e.target.closest('.karthika-ai-pill-btn');
        if (pill) {
          document.querySelectorAll('.karthika-ai-pill-btn').forEach(b => b.classList.remove('is-active'));
          pill.classList.add('is-active');

          const recipeKey = pill.dataset.recipe;
          const data = recipes[recipeKey];
          if (data) {
            const titleEl = document.getElementById('KarthikaAIRecipeTitle');
            const priceEl = document.getElementById('KarthikaAIRecipePrice');
            const listEl = document.getElementById('KarthikaAIIngredientList');

            if (titleEl) titleEl.textContent = data.title;
            if (priceEl) priceEl.textContent = data.price;
            if (listEl) {
              listEl.innerHTML = data.ingredients.map(ing => '<div>' + ing + '</div>').join('');
            }
          }
          return;
        }

        const buildBasketBtn = e.target.closest('.karthika-ai-add-all-btn');
        if (buildBasketBtn) {
          CartManager.openCartDrawer();
        }
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