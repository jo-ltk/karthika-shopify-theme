(() => {
  'use strict';

  const Checkout = {
    lock: false,
    timeoutId: 0,
    lastButton: null,

    strings() {
      return {
        loading: 'Redirecting to checkout…',
        empty: 'Your cart is empty. Add items before checking out.',
        unavailable: 'An item in your cart is no longer available. Update your cart and try again.',
        network: "We couldn't reach checkout. Check your connection and try again.",
        failed: 'Checkout could not start. No order was placed.',
        ...(window.karthikaCheckoutStrings || {}),
      };
    },

    buttons() {
      return document.querySelectorAll('button[name="checkout"], [data-karthika-checkout]');
    },

    errorEl(button) {
      const source = button || this.lastButton;
      const formId = source?.getAttribute('form') || '';
      const form = source?.form || (formId ? document.getElementById(formId) : null);
      if (form) {
        const nested = form.querySelector('.cart-errors');
        if (nested) return nested;
        if (form.id === 'CartDrawer-Form') return document.getElementById('CartDrawer-CartErrors');
        if (form.id === 'cart') return document.getElementById('cart-errors');
        if (form.id === 'cart-notification-form') return document.getElementById('cart-notification-errors');
      }
      return (
        document.getElementById('cart-errors') ||
        document.getElementById('CartDrawer-CartErrors') ||
        document.getElementById('cart-notification-errors')
      );
    },

    showError(message, button) {
      const el = this.errorEl(button);
      if (!el) return;
      el.textContent = message || '';
      el.hidden = !message;
      el.setAttribute('tabindex', '-1');
      if (message) {
        try {
          el.focus();
        } catch (err) {}
      }
    },

    setBusy(busy) {
      const loading = this.strings().loading || 'Redirecting to checkout…';
      this.buttons().forEach((btn) => {
        const label = btn.querySelector('[data-checkout-label]');
        const spinner = btn.querySelector('.loading__spinner');
        if (busy) {
          if (label && !btn.dataset.checkoutIdleLabel) {
            btn.dataset.checkoutIdleLabel = label.textContent;
          }
          btn.disabled = true;
          btn.setAttribute('aria-busy', 'true');
          if (label) label.textContent = loading;
          if (spinner) spinner.classList.remove('hidden');
        } else {
          const wasEmpty = btn.hasAttribute('data-checkout-empty');
          btn.disabled = wasEmpty;
          btn.removeAttribute('aria-busy');
          if (label && btn.dataset.checkoutIdleLabel) label.textContent = btn.dataset.checkoutIdleLabel;
          if (spinner) spinner.classList.add('hidden');
        }
      });
    },

    clearTimer() {
      if (this.timeoutId) {
        window.clearTimeout(this.timeoutId);
        this.timeoutId = 0;
      }
    },

    begin(button) {
      if (this.lock) return false;
      this.lock = true;
      this.lastButton = button || this.lastButton;
      this.showError('', this.lastButton);
      this.setBusy(true);
      this.clearTimer();
      this.timeoutId = window.setTimeout(() => {
        if (document.visibilityState === 'visible') {
          this.fail(this.strings().failed);
        }
      }, 15000);
      return true;
    },

    reset() {
      this.clearTimer();
      this.lock = false;
      this.setBusy(false);
    },

    fail(message) {
      this.reset();
      if (message) this.showError(message, this.lastButton);
    },

    cartJsonUrl() {
      const cartUrl = window.routes?.cart_url || '/cart';
      return cartUrl.indexOf('.js') === -1 ? `${cartUrl}.js` : cartUrl;
    },

    async validateCart() {
      const strings = this.strings();
      let response;
      try {
        response = await fetch(this.cartJsonUrl(), { credentials: 'same-origin', cache: 'no-store' });
      } catch (err) {
        throw new Error(strings.network || strings.failed);
      }
      if (!response.ok) throw new Error(strings.network || strings.failed);
      const cart = await response.json();
      if (!cart || !cart.item_count) {
        throw new Error(strings.empty);
      }
      const unavailable = (cart.items || []).find((item) => item && item.available === false);
      if (unavailable) {
        throw new Error(strings.unavailable);
      }
      return cart;
    },

    submitForm(button) {
      const formId = button.getAttribute('form') || '';
      const form = button.form || (formId ? document.getElementById(formId) : null);
      if (!form) {
        this.fail(this.strings().failed);
        return;
      }
      if (!form.querySelector('input[name="checkout"]')) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'checkout';
        input.value = '';
        form.appendChild(input);
      }
      form.submit();
    },

    hasFullDeliveryGift() {
      return Boolean(document.querySelector('karthika-delivery-gift:not([data-compact="true"])'));
    },

    bind() {
      document.addEventListener(
        'click',
        (event) => {
          const button = event.target.closest('button[name="checkout"], [data-karthika-checkout]');
          if (!button) return;
          if (this.lock) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        },
        true
      );

      document.addEventListener('click', async (event) => {
        const button = event.target.closest('button[name="checkout"], [data-karthika-checkout]');
        if (!button) return;
        if (this.lock) {
          event.preventDefault();
          return;
        }
        if (button.disabled) return;
        if (event.defaultPrevented) return;
        if (this.hasFullDeliveryGift()) return;

        event.preventDefault();
        if (!this.begin(button)) return;
        try {
          await this.validateCart();
          this.submitForm(button);
        } catch (err) {
          this.fail(err && err.message ? err.message : this.strings().failed);
        }
      });

      window.addEventListener('pageshow', (event) => {
        if (event.persisted || this.lock) this.reset();
      });
    },
  };

  window.Karthika = window.Karthika || {};
  window.Karthika.Checkout = Checkout;
  Checkout.bind();
})();
