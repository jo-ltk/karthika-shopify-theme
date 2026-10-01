/**
 * karthika-atc-cta.js
 * Smart Add-to-Cart / Go-to-Cart button for Karthika Supermarket.
 *
 * Flow
 * ────
 * 1. On mount → fetch /cart.js → show "Add to cart" or "Go to cart"
 * 2. Click "Add to cart" → let native ProductForm submit run
 *    → intercept BEFORE navigation to flip state, then navigate to /cart
 * 3. Back-button restore (bfcache) → pageshow event forces a fresh cart check,
 *    always overriding whatever frozen state the page was restored with
 * 4. "Go to cart" click → navigate to /cart
 * 5. Quantity change while in-cart → AJAX update via /cart/change.js
 * 6. Variant switch → re-check cart for new variant
 */

if (!customElements.get('karthika-atc-cta')) {
  customElements.define(
    'karthika-atc-cta',
    class KarthikaAtcCta extends HTMLElement {

      /** @type {'add'|'adding'|'in-cart'|'updating'} */
      _state = 'add';
      _variantId = '';
      _cartUpdateUnsub = null;
      _cartErrorUnsub  = null;
      _variantChangeUnsub = null;
      _variantObserver = null;
      _qtyAbortController = null;
      _pagesShowHandler = null;

      // ─────────────────────────────────────────────────────────────────────
      // Lifecycle
      // ─────────────────────────────────────────────────────────────────────

      connectedCallback() {
        this._variantId = this.dataset.variantId || '';

        this._btn     = this.querySelector('button');
        this._textEl  = this.querySelector('.karthika-atc-text');
        this._iconEl  = this.querySelector('.karthika-atc-icon');
        this._errorEl = this.querySelector('.karthika-atc-error');

        if (!this._btn) return;

        // Capture-phase: intercept click before ProductForm sees it
        this._btn.addEventListener('click', this._onButtonClick.bind(this), true);

        // Subscribe to Shopify's pubsub bus
        if (typeof subscribe === 'function' && window.PUB_SUB_EVENTS) {
          this._cartUpdateUnsub = subscribe(PUB_SUB_EVENTS.cartUpdate, this._onCartUpdate.bind(this));
          this._cartErrorUnsub  = subscribe(PUB_SUB_EVENTS.cartError,  this._onCartError.bind(this));
          if (window.PUB_SUB_EVENTS.variantChange) {
            this._variantChangeUnsub = subscribe(PUB_SUB_EVENTS.variantChange, this._onVariantChangePubSub.bind(this));
          }
        }

        this._watchVariantInput();
        this._watchQuantityInput();

        // ── bfcache fix ────────────────────────────────────────────────────
        // When user hits the back button the browser may restore the page from
        // bfcache with JS state frozen at "adding". pageshow with
        // persisted=true means we're in a bfcache restore — always re-check
        // the real cart regardless of current state.
        this._pagesShowHandler = (evt) => {
          if (evt.persisted) {
            this._state = 'add'; // clear stale adding/updating state first
            this._checkCartState();
          }
        };
        window.addEventListener('pageshow', this._pagesShowHandler);

        // Initial cart state check
        this._checkCartState();
      }

      disconnectedCallback() {
        this._cartUpdateUnsub?.();
        this._cartErrorUnsub?.();
        this._variantChangeUnsub?.();
        this._variantObserver?.disconnect();
        this._qtyAbortController?.abort();
        if (this._pagesShowHandler) {
          window.removeEventListener('pageshow', this._pagesShowHandler);
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // Click handler
      // ─────────────────────────────────────────────────────────────────────

      _onButtonClick(evt) {
        if (this._state === 'in-cart') {
          evt.preventDefault();
          evt.stopImmediatePropagation();
          window.location.href = window.routes?.cart_url || '/cart';
          return;
        }

        if (this._state === 'adding' || this._state === 'updating') {
          // Block duplicate clicks without touching aria-disabled on the
          // button itself — product-form.js bails early if it sees
          // aria-disabled="true" on the submit button.
          evt.preventDefault();
          evt.stopImmediatePropagation();
          return;
        }

        // state === 'add':
        // Let the native ProductForm submit run. Just show visual feedback.
        // Do NOT set aria-disabled — that would break product-form.js.
        this._state = 'adding';
        this._renderButton();
        this._clearError();
      }

      // ─────────────────────────────────────────────────────────────────────
      // PubSub handlers
      // ─────────────────────────────────────────────────────────────────────

      _onCartUpdate(event) {
        if (event?.source === 'product-form') {
          const updatedId = String(event.productVariantId || '');
          // If this update is for our variant, redirect to /cart immediately.
          // If it's for a different variant (e.g. quick-add), re-check ours.
          if (!updatedId || updatedId === this._variantId) {
            this._setState('in-cart');
            this._clearError();
            // Redirect to the dedicated cart page after a successful add-to-cart.
            window.location.href = window.routes?.cart_url || '/cart';
          } else {
            this._checkCartState();
          }
        } else {
          // Cart changed elsewhere (drawer, quick-add, mini-cart remove…)
          this._checkCartState();
        }
      }

      _onCartError(event) {
        const errId = String(event?.productVariantId || '');
        if (errId && errId !== this._variantId) return;

        this._setState('add');
        const msg =
          (Array.isArray(event?.errors) ? event.errors.join(' ') : event?.errors) ||
          event?.message ||
          'Could not add to cart. Please try again.';
        this._showError(msg);
      }

      _onVariantChangePubSub(event) {
        const sectionId = this.dataset.sectionId;
        if (sectionId && event?.data?.sectionId && event.data.sectionId !== sectionId) return;

        const newId = String(event?.data?.variant?.id || '');
        if (newId && newId !== this._variantId) {
          this._variantId = newId;
          this.dataset.variantId = newId;
          this._clearError();
          this._checkCartState();
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // Watchers
      // ─────────────────────────────────────────────────────────────────────

      _watchVariantInput() {
        const productForm =
          this.closest('product-form') ||
          document.querySelector(`product-form[data-section-id="${this.dataset.sectionId}"]`);

        const input = productForm?.querySelector('input.product-variant-id, input[name="id"]');
        if (!input) return;

        const onChange = () => {
          const newId = String(input.value || '');
          if (newId && newId !== this._variantId) {
            this._variantId = newId;
            this.dataset.variantId = newId;
            this._clearError();
            this._checkCartState();
          }
        };

        this._variantObserver = new MutationObserver(onChange);
        this._variantObserver.observe(input, { attributes: true, attributeFilter: ['value'] });
        input.addEventListener('change', onChange);
      }

      _watchQuantityInput() {
        const productForm =
          this.closest('product-form') ||
          document.querySelector(`product-form[data-section-id="${this.dataset.sectionId}"]`);

        const sectionWrapper =
          productForm?.closest('[id^="ProductInfo-"]') ||
          productForm?.closest('.product__info-container') ||
          productForm?.parentElement;

        const qtyInput = sectionWrapper?.querySelector('input.quantity__input, quantity-input input');
        console.log('[karthika-atc-cta] _watchQuantityInput →',
          'productForm:', productForm,
          'sectionWrapper:', sectionWrapper,
          'qtyInput found:', qtyInput,
          'qtyInput id:', qtyInput?.id,
          'qtyInput name:', qtyInput?.name
        );
        if (!qtyInput) return;

        this._qtyInput = qtyInput;

        let debounceTimer = null;
        qtyInput.addEventListener('change', () => {
          console.log('[karthika-atc-cta] qty change event fired → state:', this._state, 'value:', qtyInput.value);
          if (this._state !== 'in-cart') return;
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            const qty = parseInt(qtyInput.value, 10) || 1;
            console.log('[karthika-atc-cta] debounce fired → calling _updateCartLineQuantity with qty:', qty);
            this._updateCartLineQuantity(qty);
          }, 300);
        });
      }

      // ─────────────────────────────────────────────────────────────────────
      // Cart operations
      // ─────────────────────────────────────────────────────────────────────

      _updateCartLineQuantity(newQty) {
        const variantId = this._variantId;
        console.log('[karthika-atc-cta] _updateCartLineQuantity → variantId:', variantId, 'newQty:', newQty);
        if (!variantId) {
          console.warn('[karthika-atc-cta] _updateCartLineQuantity aborted — no variantId');
          return;
        }

        this._qtyAbortController?.abort();
        this._qtyAbortController = new AbortController();
        const signal = this._qtyAbortController.signal;

        this._setState('updating');

        // First fetch the current cart to find the 1-based line index for this
        // variant. Shopify's /cart/change.js expects `line` (1-based index) or
        // `id` set to the full line item key string — NOT the bare variant ID
        // integer, which causes a 422 response.
        console.log('[karthika-atc-cta] fetching /cart.js to find line index...');
        fetch('/cart.js', { headers: { 'Content-Type': 'application/json' }, signal })
          .then((r) => r.json())
          .then((cart) => {
            console.log('[karthika-atc-cta] /cart.js response →', cart);
            if (signal.aborted) { console.log('[karthika-atc-cta] aborted after /cart.js'); return; }
            if (variantId !== this._variantId) { console.log('[karthika-atc-cta] variant changed mid-fetch, bailing'); return; }

            console.log('[karthika-atc-cta] cart items:', cart.items?.map(i => ({ key: i.key, variant_id: i.variant_id, quantity: i.quantity })));

            const lineIndex =
              cart.items?.findIndex(
                (item) => String(item.variant_id) === String(variantId)
              ) ?? -1;

            console.log('[karthika-atc-cta] lineIndex (0-based):', lineIndex, '→ will send line:', lineIndex + 1);

            if (lineIndex === -1) {
              // Item is no longer in the cart — reset button state
              console.warn('[karthika-atc-cta] variant not found in cart — resetting to add state');
              this._setState('add');
              return;
            }

            const payload = { line: lineIndex + 1, quantity: newQty };
            console.log('[karthika-atc-cta] POST /cart/change.js payload:', payload);

            return fetch(window.routes?.cart_change_url || '/cart/change.js', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              signal,
              body: JSON.stringify(payload),
            })
              .then((r) => {
                console.log('[karthika-atc-cta] /cart/change.js HTTP status:', r.status, 'Content-Type:', r.headers.get('content-type'));
                const ct = r.headers.get('content-type') || '';
                if (!ct.includes('application/json')) {
                  // Dev server or redirect returned HTML — fall back to reading
                  // the real cart state from /cart.js to confirm the update.
                  console.warn('[karthika-atc-cta] /cart/change.js returned non-JSON (content-type:', ct, ') — falling back to /cart.js to verify');
                  return fetch('/cart.js', { headers: { 'Accept': 'application/json' }, signal })
                    .then((r2) => r2.json())
                    .then((fallbackCart) => ({ __fallback: true, cart: fallbackCart }));
                }
                return r.json().then((data) => ({ __fallback: false, cart: data }));
              })
              .then((result) => {
                if (!result) return;
                if (signal.aborted || variantId !== this._variantId) return;

                const { __fallback, cart: updatedCart } = result;
                console.log('[karthika-atc-cta] /cart/change.js final cart (fallback=' + __fallback + '):', updatedCart);

                if (!__fallback && updatedCart.status) {
                  console.error('[karthika-atc-cta] Shopify returned error status:', updatedCart.status, updatedCart);
                  throw new Error(updatedCart.description || 'Cart update failed');
                }

                const stillInCart =
                  updatedCart.items?.some(
                    (item) => String(item.variant_id) === String(variantId)
                  ) ?? false;

                const updatedItem = updatedCart.items?.find(
                  (item) => String(item.variant_id) === String(variantId)
                );

                console.log('[karthika-atc-cta] stillInCart:', stillInCart);
                this._setState(stillInCart ? 'in-cart' : 'add');

                // Sync the quantity display to what the cart now holds
                if (stillInCart && updatedItem) {
                  this._syncQuantityDisplay(updatedItem.quantity);
                }

                if (typeof publish === 'function' && window.PUB_SUB_EVENTS?.cartUpdate) {
                  publish(PUB_SUB_EVENTS.cartUpdate, {
                    source: 'karthika-atc-cta',
                    cartData: updatedCart,
                  });
                }
              });
          })
          .catch((err) => {
            if (err?.name === 'AbortError') return;
            console.error('[karthika-atc-cta] cart quantity update failed:', err);
            this._setState('in-cart');
            this._showError('Could not update quantity. Please try again.');
          });
      }

      /**
       * Fetch /cart.js and sync button state to actual cart contents.
       * NOTE: This always overrides the current state — including 'adding' —
       * because we use it for bfcache restores where 'adding' is stale.
       */
      _checkCartState() {
        const variantId = this._variantId;
        if (!variantId) return;

        console.log('[karthika-atc-cta] _checkCartState → variantId:', variantId);
        fetch('/cart.js', { headers: { 'Content-Type': 'application/json' } })
          .then((r) => r.json())
          .then((cart) => {
            if (variantId !== this._variantId) return; // variant switched mid-fetch

            const cartItem = cart?.items?.find(
              (item) => String(item.variant_id) === String(variantId)
            );
            const inCart = !!cartItem;
            const cartQty = cartItem?.quantity ?? 0;

            console.log('[karthika-atc-cta] _checkCartState result → inCart:', inCart, 'cartQty:', cartQty, 'items:', cart?.items?.map(i => ({ variant_id: i.variant_id, quantity: i.quantity })));
            this._setState(inCart ? 'in-cart' : 'add');

            // Always sync quantity display — covers bfcache restores (qty changed
            // elsewhere) and returning after a cart deletion (cartQty = 0 resets
            // the input back to the variant minimum).
            this._syncQuantityDisplay(cartQty);
          })
          .catch(() => {
            // Network failure — reset to 'add' so the user isn't stuck
            if (this._state === 'adding') this._setState('add');
          });
      }

      /**
       * Update the quantity input value and the "X in cart" label to reflect
       * the actual quantity currently in the cart.
       */
      _syncQuantityDisplay(cartQty) {
        // Update the quantity input value.
        // When cartQty is 0 (item deleted), reset to the variant's minimum order qty.
        const qtyInput = this._qtyInput;
        if (qtyInput) {
          const minQty = parseInt(qtyInput.dataset.min || qtyInput.min || '1', 10);
          const targetValue = cartQty > 0 ? cartQty : minQty;
          if (parseInt(qtyInput.value, 10) !== targetValue) {
            console.log('[karthika-atc-cta] _syncQuantityDisplay → updating input from', qtyInput.value, 'to', targetValue, '(cartQty:', cartQty, ')');
            qtyInput.value = targetValue;
          }
          // Keep data-cart-quantity in sync so volume pricing / other scripts see the right value
          qtyInput.dataset.cartQuantity = cartQty;
        }

        // Update the "X in cart" label — quantity number lives in span.quantity-cart
        const sectionId = this.dataset.sectionId;
        const labelWrapper = document.querySelector(
          `label[for="Quantity-${sectionId}"] .quantity__rules-cart`
        );
        if (labelWrapper) {
          // Hide the label entirely when item is not in cart
          labelWrapper.classList.toggle('hidden', cartQty === 0);

          if (cartQty > 0) {
            const qtySpan = labelWrapper.querySelector('.quantity-cart');
            if (qtySpan) {
              qtySpan.textContent = cartQty;
              console.log('[karthika-atc-cta] _syncQuantityDisplay → updated .quantity-cart span to', cartQty);
            }
          }
        }

        // Update the visually-hidden aria label
        const ariaLabel = document.getElementById(`quantity-label-${sectionId}`);
        if (ariaLabel) {
          ariaLabel.textContent = cartQty > 0
            ? `Quantity (${cartQty} in cart)`
            : 'Quantity';
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // State machine + render
      // ─────────────────────────────────────────────────────────────────────

      _setState(newState) {
        const prev = this._state;
        this._state = newState;
        if (prev !== newState || !this._initialRenderDone) {
          this._initialRenderDone = true;
          this._renderButton();
        }
      }

      _renderButton() {
        if (!this._btn || !this._textEl) return;

        const addText      = this.dataset.addToCartText || 'Add to cart';
        const goText       = this.dataset.goToCartText  || 'Go to cart';
        const addingText   = this.dataset.addingText    || 'Adding...';

        switch (this._state) {

          case 'add':
            this._btn.type = 'submit';
            this._btn.removeAttribute('aria-disabled');
            this._btn.removeAttribute('aria-label');
            this._btn.classList.remove('karthika-btn-gotocart');
            this._btn.classList.add('karthika-btn-addtocart');
            if (this._iconEl) { this._iconEl.innerHTML = _ICON_BAG; this._iconEl.style.display = ''; }
            this._textEl.textContent = addText;
            break;

          case 'adding':
            // Keep type="submit" and NO aria-disabled — product-form.js must
            // be able to proceed with the fetch to /cart/add.js.
            this._btn.type = 'submit';
            this._btn.removeAttribute('aria-disabled');
            this._btn.classList.remove('karthika-btn-gotocart');
            this._btn.classList.add('karthika-btn-addtocart');
            if (this._iconEl) this._iconEl.style.display = 'none';
            this._textEl.textContent = addingText;
            break;

          case 'in-cart':
            this._btn.type = 'button'; // prevents accidental form submit
            this._btn.removeAttribute('aria-disabled');
            this._btn.setAttribute('aria-label', goText);
            this._btn.classList.remove('karthika-btn-addtocart');
            this._btn.classList.add('karthika-btn-gotocart');
            if (this._iconEl) { this._iconEl.innerHTML = _ICON_CART; this._iconEl.style.display = ''; }
            this._textEl.textContent = goText;
            break;

          case 'updating':
            this._btn.type = 'button';
            this._btn.setAttribute('aria-disabled', 'true');
            this._btn.classList.remove('karthika-btn-addtocart');
            this._btn.classList.add('karthika-btn-gotocart');
            if (this._iconEl) { this._iconEl.innerHTML = _ICON_CART; this._iconEl.style.display = ''; }
            this._textEl.textContent = 'Updating...';
            break;
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // Error helpers
      // ─────────────────────────────────────────────────────────────────────

      _showError(msg) {
        if (!this._errorEl) return;
        this._errorEl.textContent = msg;
        this._errorEl.removeAttribute('hidden');
      }

      _clearError() {
        if (!this._errorEl) return;
        this._errorEl.textContent = '';
        this._errorEl.setAttribute('hidden', '');
      }
    }
  );

  // ── SVG icons (defined once, outside the class) ───────────────────────────

  const _ICON_BAG = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
    <line x1="3" y1="6" x2="21" y2="6"/>
    <path d="M16 10a4 4 0 0 1-8 0"/>
  </svg>`;

  const _ICON_CART = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="9" cy="21" r="1"/>
    <circle cx="20" cy="21" r="1"/>
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
  </svg>`;
}
