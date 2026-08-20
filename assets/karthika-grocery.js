/**
 * Karthika Supermarket - Client Grocery Engine
 * Handles Cart State, Quantity Steppers, Predictive Search, Location Selector & AI Meal Assistant
 */

(function () {
  'use strict';

  window.Karthika = window.Karthika || {};

  /* --------------------------------------------------------------------------
     1. Cart State & Quantity Steppers
     -------------------------------------------------------------------------- */
  const CartManager = {
    state: {
      item_count: 0,
      total_price: 0,
      items: [],
      variantMap: {}
    },

    async init() {
      await this.refreshCartState();
      this.bindEvents();
      this.bindCartSummary();
      this.bindScrollNavigation();
      this.syncAllSteppers();
    },

    async refreshCartState() {
      try {
        const response = await fetch(`${window.routes?.cart_url || '/cart'}.js`);
        if (!response.ok) return;
        const cart = await response.json();
        this.state.item_count = cart.item_count;
        this.state.total_price = cart.total_price;
        this.state.items = cart.items;
        
        this.state.variantMap = {};
        cart.items.forEach(item => {
          this.state.variantMap[item.variant_id] = item.quantity;
        });

        this.updateBadges();
        this.syncAllSteppers();
        document.dispatchEvent(new CustomEvent('karthika:cart-updated', { detail: cart }));
      } catch (err) {
        console.warn('[Karthika Cart] Refresh warning:', err);
      }
    },

    updateBadges() {
      const count = this.state.item_count || 0;
      document.querySelectorAll('.karthika-nav-badge, .karthika-cart-badge, .cart-count-bubble span').forEach(badge => {
        badge.textContent = count;
        if (count > 0) {
          badge.style.display = 'flex';
          badge.classList.remove('hidden');
        } else {
          badge.style.display = 'none';
        }
      });
    },

    syncAllSteppers() {
      document.querySelectorAll('.karthika-stepper').forEach(stepper => {
        const variantId = parseInt(stepper.dataset.variantId, 10);
        if (!variantId) return;

        const qty = this.state.variantMap[variantId] || 0;
        const qtyDisplay = stepper.querySelector('.karthika-stepper-qty');
        
        if (qty > 0) {
          stepper.classList.add('is-added');
          if (qtyDisplay) qtyDisplay.textContent = qty;
        } else {
          stepper.classList.remove('is-added');
          if (qtyDisplay) qtyDisplay.textContent = '1';
        }
      });
    },

    async add(variantId, quantity = 1, openDrawer = false) {
      try {
        const formData = new FormData();
        formData.append('id', variantId);
        formData.append('quantity', quantity);

        const response = await fetch(`${window.routes?.cart_add_url || '/cart/add'}.js`, {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          const errData = await response.json();
          alert(errData.description || 'Could not add item to cart.');
          return;
        }

        await this.refreshCartState();

        if (openDrawer) {
          this.openCartDrawer();
        }
      } catch (err) {
        console.error('[Karthika Cart] Add error:', err);
      }
    },

    async change(variantId, quantity) {
      try {
        const response = await fetch(`${window.routes?.cart_change_url || '/cart/change'}.js`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: String(variantId), quantity: quantity })
        });

        if (response.ok) {
          await this.refreshCartState();
        }
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
          if (cart?.items) this.renderCartSummary(cart, summary);
          else this.refreshCartState();
        });
      }

      summary.addEventListener('click', () => {
        window.location.href = window.routes?.cart_url || '/cart';
      });
    },

    renderCartSummary(cart, summary) {
      const count = cart?.item_count || 0;
      const countEl = summary.querySelector('.karthika-floating-cart-count');
      const thumbnailsEl = summary.querySelector('.karthika-floating-cart-thumbnails');

      if (countEl) countEl.textContent = `${count} ITEMS`;
      if (thumbnailsEl) {
        const images = (cart?.items || []).slice(0, 3).filter((item) => item.image).map((item) => {
          const image = document.createElement('img');
          image.src = item.image;
          image.alt = '';
          image.width = 36;
          image.height = 36;
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
      // Stepper Add Button Click
      document.addEventListener('click', async (e) => {
        const addBtn = e.target.closest('.karthika-stepper-add-btn');
        if (addBtn) {
          const stepper = addBtn.closest('.karthika-stepper');
          const variantId = stepper?.dataset?.variantId;
          
          if (variantId) {
            await this.add(variantId, 1, false);
          } else {
            // Demo fallback
            stepper.classList.add('is-added');
            this.state.item_count = (this.state.item_count || 0) + 1;
            this.updateBadges();
          }
          return;
        }

        // Stepper Minus Click
        const minusBtn = e.target.closest('.karthika-stepper-btn--minus');
        if (minusBtn) {
          const stepper = minusBtn.closest('.karthika-stepper');
          const variantId = stepper?.dataset?.variantId;
          const qtyEl = stepper.querySelector('.karthika-stepper-qty');
          let currentQty = parseInt(qtyEl?.textContent || '1', 10);
          
          if (variantId) {
            await this.change(variantId, Math.max(0, currentQty - 1));
          } else {
            // Demo fallback
            currentQty = currentQty - 1;
            if (currentQty <= 0) {
              stepper.classList.remove('is-added');
              if (qtyEl) qtyEl.textContent = '1';
            } else {
              if (qtyEl) qtyEl.textContent = currentQty;
            }
            this.state.item_count = Math.max(0, (this.state.item_count || 1) - 1);
            this.updateBadges();
          }
          return;
        }

        // Stepper Plus Click
        const plusBtn = e.target.closest('.karthika-stepper-btn--plus');
        if (plusBtn) {
          const stepper = plusBtn.closest('.karthika-stepper');
          const variantId = stepper?.dataset?.variantId;
          const qtyEl = stepper.querySelector('.karthika-stepper-qty');
          let currentQty = parseInt(qtyEl?.textContent || '1', 10);
          
          if (variantId) {
            await this.change(variantId, currentQty + 1);
          } else {
            // Demo fallback
            currentQty = currentQty + 1;
            if (qtyEl) qtyEl.textContent = currentQty;
            this.state.item_count = (this.state.item_count || 0) + 1;
            this.updateBadges();
          }
          return;
        }

        // Cart Trigger
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
        "✓ Kaima Jeerakasala Biryani Rice (1kg) — $4.80",
        "✓ Fresh Farm Chicken Curry Cut (1kg) — $9.50",
        "✓ Eastern Biryani Masala & Pure Ghee — $4.40",
        "✓ Fresh Mint Leaves, Coriander & Onions — $5.80"
      ]
    },
    kerala_breakfast: {
      title: "Kerala Appam & Stew Kit",
      price: "$14.20",
      ingredients: [
        "✓ Brahmins Easy Appam Mix (1kg) — $3.60",
        "✓ Pure Coconut Milk Can (400ml) — $2.80",
        "✓ Fresh Stew Veggies (Potato, Carrot, Beans) — $4.80",
        "✓ Whole Kerala Spices & Ginger Pack — $3.00"
      ]
    },
    sambar: {
      title: "Authentic Sambar & Rasam Kit",
      price: "$11.80",
      ingredients: [
        "✓ Karthika Premium Toor Dal (1kg) — $3.50",
        "✓ MTR Traditional Sambar Powder — $2.40",
        "✓ Sambar Veggies (Drumstick, Shallots, Tomato) — $4.10",
        "✓ Natural Tamarind Block (200g) — $1.80"
      ]
    },
    tea_snacks: {
      title: "Kerala Evening Chai & Snacks Combo",
      price: "$13.90",
      ingredients: [
        "✓ Crispy Kerala Banana Chips (250g) — $4.50",
        "✓ Spicy Mixture & Ribbon Pakoda — $3.80",
        "✓ AVT Premium Kerala Dust Tea (500g) — $5.60"
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
              listEl.innerHTML = data.ingredients.map(ing => `<div>${ing}</div>`).join('');
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

  // Expose on global object
  window.Karthika.Cart = CartManager;
  window.Karthika.Location = LocationManager;
  window.Karthika.Search = SearchManager;
  window.Karthika.AI = AIAssistantManager;

  // Initialize all managers on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    CartManager.init();
    LocationManager.init();
    SearchManager.init();
    AIAssistantManager.init();
  });
})();
