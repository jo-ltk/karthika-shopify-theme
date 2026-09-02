(() => {
  const ATTR = {
    type: 'Delivery type',
    method: 'Delivery method',
    address: 'Delivery address',
    recipientName: 'Recipient name',
    recipientPhone: 'Recipient phone',
    giftMessage: 'Gift message',
    addressId: '_delivery_address_id',
    country: '_delivery_country',
    zip: '_delivery_zip',
    province: '_delivery_province',
  };

  const TYPE_MY = 'My address';
  const TYPE_GIFT = 'Gift';

  const CART_ORDER_ATTR = '_cart_line_order';

  function fetchConfigJSON() {
    if (typeof fetchConfig === 'function') return fetchConfig('javascript');
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    };
  }

  async function fetchCart() {
    const url = `${window.routes?.cart_url || '/cart'}.js`;
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) return null;
    return response.json();
  }

  async function writeAttributes(partial) {
    const cart = await fetchCart();
    if (!cart) return null;
    const attributes = Object.assign({}, cart.attributes || {}, partial);
    if (window.CartItemOrder?.ATTRIBUTE && cart.attributes?.[CART_ORDER_ATTR]) {
      attributes[CART_ORDER_ATTR] = cart.attributes[CART_ORDER_ATTR];
    }
    if (partial[ATTR.type] !== TYPE_GIFT) {
      delete attributes[ATTR.recipientName];
      delete attributes[ATTR.recipientPhone];
      delete attributes[ATTR.giftMessage];
    }
    Object.keys(attributes).forEach((key) => {
      if (attributes[key] == null) delete attributes[key];
    });
    const updateUrl = window.routes?.cart_update_url || '/cart/update.js';
    const response = await fetch(updateUrl, {
      ...fetchConfigJSON(),
      body: JSON.stringify({ attributes }),
    });
    if (!response.ok) return cart;
    const updated = await response.json();
    if (!updated || updated.errors || updated.status) return cart;
    if (window.CartItemOrder) window.CartItemOrder._lastCart = updated;
    return updated;
  }

  function formatAddress(parts) {
    return [parts.name, parts.address1, parts.address2, [parts.city, parts.province, parts.zip].filter(Boolean).join(' '), parts.country]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  class KarthikaDeliveryGift extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this.compact = this.dataset.compact === 'true';
      this.formId = this.dataset.formId || 'cart';
      this._persistQueue = Promise.resolve();
      this.bindCountrySelectors();
      if (!window.Shopify?.CountryProvinceSelector) {
        window.addEventListener('load', () => this.bindCountrySelectors(), { once: true });
      }
      this.bindEvents();
      this.syncUi();
      this.updateHiddenInputs();
      if (!this.compact) {
        this.schedulePersist();
        this.refreshShippingRates();
      }
      this._cartUnsub =
        window.PUB_SUB_EVENTS && typeof subscribe === 'function'
          ? subscribe(PUB_SUB_EVENTS.cartUpdate, (event) => {
              const count = event?.cartData?.item_count;
              if (typeof count === 'number') this.classList.toggle('is-empty', count === 0);
              if (!this.compact) this.refreshShippingRates();
            })
          : null;
      KarthikaDeliveryGift.bindCheckoutOnce();
    }

    disconnectedCallback() {
      if (this._cartUnsub) this._cartUnsub();
    }

    bindCountrySelectors() {
      if (!window.Shopify?.CountryProvinceSelector) return;
      this.querySelectorAll('[data-address-country-select]').forEach((select) => {
        if (select.dataset.kdgBound === 'true') return;
        const formId = select.dataset.formId;
        const country = document.getElementById(`AddressCountry_${formId}`);
        const province = document.getElementById(`AddressProvince_${formId}`);
        if (!country || !province) return;
        select.dataset.kdgBound = 'true';
        new Shopify.CountryProvinceSelector(`AddressCountry_${formId}`, `AddressProvince_${formId}`, {
          hideElement: `AddressProvinceContainer_${formId}`,
        });
      });
    }

    bindEvents() {
      this.addEventListener('change', (event) => {
        const target = event.target;
        if (target.matches('[name="kdg-type"], [name="kdg-address"], [name="kdg-method"], [name="kdg-one-time"]')) {
          this.syncUi();
          if (target.matches('[name="kdg-address"]')) this.prefillGiftFromAddress(target);
          this.schedulePersist();
          if (target.matches('[name="kdg-address"], [name="kdg-one-time"]')) this.refreshShippingRates();
          return;
        }
        if (target.closest('[data-kdg-guest-fields], [data-kdg-gift-fields]')) {
          this.schedulePersist();
          if (target.matches('[data-kdg-field="zip"], [data-kdg-field="country"], [data-kdg-field="province"]')) {
            this.refreshShippingRates();
          }
        }
      });

      this.addEventListener('input', (event) => {
        if (event.target.closest('[data-kdg-gift-fields], [data-kdg-guest-fields]')) {
          this.schedulePersist();
        }
      });

      this.addEventListener('click', (event) => {
        const addBtn = event.target.closest('[data-kdg-add]');
        if (addBtn) {
          event.preventDefault();
          this.togglePanel(this.querySelector('[data-kdg-add-panel]'), true);
          this.querySelectorAll('[data-kdg-edit-panel]').forEach((panel) => this.togglePanel(panel, false));
          return;
        }

        const editBtn = event.target.closest('[data-kdg-edit]');
        if (editBtn) {
          event.preventDefault();
          const panel = this.querySelector(editBtn.getAttribute('aria-controls') ? `#${editBtn.getAttribute('aria-controls')}` : null);
          this.querySelectorAll('[data-kdg-edit-panel], [data-kdg-add-panel]').forEach((item) => {
            this.togglePanel(item, item === panel);
          });
          return;
        }

        const cancelBtn = event.target.closest('[data-kdg-cancel]');
        if (cancelBtn) {
          event.preventDefault();
          const panel = cancelBtn.closest('[data-kdg-add-panel], [data-kdg-edit-panel]');
          this.togglePanel(panel, false);
          return;
        }

        const deleteBtn = event.target.closest('[data-kdg-delete]');
        if (deleteBtn) {
          event.preventDefault();
          this.deleteAddress(deleteBtn);
        }
      });

      this.querySelectorAll('form.kdg-form').forEach((form) => {
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          this.submitAddressForm(form);
        });
      });
    }

    togglePanel(panel, open) {
      if (!panel) return;
      panel.hidden = !open;
      const control = this.querySelector(`[aria-controls="${panel.id}"]`);
      if (control) control.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    isGift() {
      const selected = this.querySelector('[name="kdg-type"]:checked');
      return (selected?.value || TYPE_MY) === TYPE_GIFT;
    }

    usesOneTimeAddress() {
      if (!this.querySelector('[data-kdg-saved-list]')) return true;
      return Boolean(this.querySelector('[name="kdg-one-time"]')?.checked);
    }

    syncUi() {
      const gift = this.isGift();
      this.querySelectorAll('[data-kdg-gift-fields]').forEach((el) => {
        el.hidden = !gift;
      });
      this.querySelectorAll('[data-kdg-type-card]').forEach((card) => {
        card.classList.toggle('is-selected', card.querySelector('input')?.checked);
      });
      this.querySelectorAll('[data-kdg-method-card]').forEach((card) => {
        card.classList.toggle('is-selected', card.querySelector('input')?.checked);
      });
      this.querySelectorAll('[data-kdg-address-card]').forEach((card) => {
        card.classList.toggle('is-selected', card.querySelector('[name="kdg-address"]')?.checked);
      });
      const oneTime = this.usesOneTimeAddress();
      this.querySelectorAll('[data-kdg-guest-fields]').forEach((el) => {
        el.hidden = !oneTime;
      });
      this.querySelectorAll('[data-kdg-saved-list]').forEach((el) => {
        el.hidden = oneTime;
      });
      this.clearError();
    }

    prefillGiftFromAddress(input) {
      if (!this.isGift() || !input) return;
      const nameField = this.querySelector('[data-kdg-field="recipient_name"]');
      const phoneField = this.querySelector('[data-kdg-field="recipient_phone"]');
      if (nameField && !nameField.value) nameField.value = input.dataset.name || '';
      if (phoneField && !phoneField.value) phoneField.value = input.dataset.phone || '';
    }

    selectedAddressInput() {
      return this.querySelector('[name="kdg-address"]:checked');
    }

    collectGuestAddress() {
      const root = this.querySelector('[data-kdg-guest-fields]');
      if (!root) return {};
      const read = (key) => root.querySelector(`[data-kdg-field="${key}"]`)?.value?.trim() || '';
      const first = read('first_name');
      const last = read('last_name');
      return {
        name: [first, last].filter(Boolean).join(' '),
        first_name: first,
        last_name: last,
        address1: read('address1'),
        address2: read('address2'),
        city: read('city'),
        country: read('country'),
        province: read('province'),
        zip: read('zip'),
        phone: read('phone'),
      };
    }

    collectPayload() {
      const type = this.isGift() ? TYPE_GIFT : TYPE_MY;
      const methodInput = this.querySelector('[name="kdg-method"]:checked');
      const method = methodInput?.value || '';
      let formatted = '';
      let addressId = '';
      let country = '';
      let zip = '';
      let province = '';
      let phone = '';
      let name = '';

      if (this.usesOneTimeAddress()) {
        const guest = this.collectGuestAddress();
        formatted = formatAddress(guest);
        country = guest.country;
        zip = guest.zip;
        province = guest.province;
        phone = guest.phone;
        name = guest.name;
        addressId = 'one_time';
      } else {
        const selected = this.selectedAddressInput();
        if (selected) {
          formatted = selected.dataset.formatted || '';
          addressId = selected.value || '';
          country = selected.dataset.country || '';
          zip = selected.dataset.zip || '';
          province = selected.dataset.province || '';
          phone = selected.dataset.phone || '';
          name = selected.dataset.name || '';
        }
      }

      const payload = {
        [ATTR.type]: type,
        [ATTR.method]: method,
        [ATTR.address]: formatted,
        [ATTR.addressId]: addressId,
        [ATTR.country]: country,
        [ATTR.zip]: zip,
        [ATTR.province]: province,
      };

      if (type === TYPE_GIFT) {
        payload[ATTR.recipientName] = this.querySelector('[data-kdg-field="recipient_name"]')?.value?.trim() || name;
        payload[ATTR.recipientPhone] = this.querySelector('[data-kdg-field="recipient_phone"]')?.value?.trim() || phone;
        payload[ATTR.giftMessage] = this.querySelector('[data-kdg-field="gift_message"]')?.value?.trim() || '';
      }

      return payload;
    }

    updateHiddenInputs() {
      const payload = this.collectPayload();
      this.querySelectorAll('[data-kdg-attr]').forEach((input) => {
        const key = input.dataset.kdgAttr;
        input.value = payload[key] || '';
      });
      const method = payload[ATTR.method];
      document.querySelectorAll('[data-kdg-footer-method]').forEach((el) => {
        el.textContent = method || el.dataset.fallback || '';
      });
    }

    schedulePersist() {
      this.updateHiddenInputs();
      clearTimeout(this._persistTimer);
      this._persistTimer = setTimeout(() => this.persist(), 400);
    }

    persist() {
      const payload = this.collectPayload();
      this.updateHiddenInputs();
      this._persistQueue = this._persistQueue
        .then(() => writeAttributes(payload))
        .catch(() => null);
      return this._persistQueue;
    }

    validate() {
      const payload = this.collectPayload();
      if (!payload[ATTR.address]) {
        return this.dataset.errorAddress || 'Choose a delivery address.';
      }
      if (!payload[ATTR.method]) {
        return this.dataset.errorMethod || 'Choose a delivery method.';
      }
      if (payload[ATTR.type] === TYPE_GIFT) {
        if (!payload[ATTR.recipientName]) {
          return this.dataset.errorRecipient || 'Enter the recipient name.';
        }
        if (!payload[ATTR.recipientPhone]) {
          return this.dataset.errorPhone || 'Enter the recipient phone number.';
        }
      }
      return '';
    }

    showError(message) {
      const region = this.querySelector('[data-kdg-error]');
      if (!region) return;
      region.hidden = !message;
      region.textContent = message || '';
    }

    clearError() {
      this.showError('');
    }

    async refreshShippingRates() {
      if (this.compact) return;
      const live = this.querySelector('[data-kdg-live-methods]');
      const fallback = this.querySelector('[data-kdg-fallback-methods]');
      if (!live || !fallback) return;
      const payload = this.collectPayload();
      if (!payload[ATTR.country] || !payload[ATTR.zip]) {
        live.hidden = true;
        fallback.hidden = false;
        return;
      }
      const params = new URLSearchParams({
        'shipping_address[country]': payload[ATTR.country],
        'shipping_address[zip]': payload[ATTR.zip],
        'shipping_address[province]': payload[ATTR.province] || '',
      });
      try {
        const response = await fetch(`${window.routes?.cart_url || '/cart'}/shipping_rates.json?${params}`, {
          credentials: 'same-origin',
        });
        if (!response.ok) throw new Error('rates');
        const data = await response.json();
        const rates = data.shipping_rates || [];
        if (!rates.length) throw new Error('empty');
        const selected = this.querySelector('[name="kdg-method"]:checked')?.value;
        live.innerHTML = rates
          .map((rate, index) => {
            const value = rate.name;
            const checked = selected ? selected === value : index === 0;
            const days = Array.isArray(rate.delivery_days) && rate.delivery_days.length
              ? `${rate.delivery_days[0]}–${rate.delivery_days[rate.delivery_days.length - 1]} days`
              : '';
            return `<label class="kdg-option kdg-option--method${checked ? ' is-selected' : ''}" data-kdg-method-card>
              <input type="radio" name="kdg-method" value="${this.escape(value)}" ${checked ? 'checked' : ''}>
              <span>
                <strong>${this.escape(rate.name)}</strong>
                <small>${this.escape(days)}</small>
              </span>
              <em>${this.escape(rate.price)} ${this.escape(rate.currency || '')}</em>
            </label>`;
          })
          .join('');
        live.hidden = false;
        fallback.hidden = true;
        fallback.querySelectorAll('input').forEach((input) => {
          input.disabled = true;
        });
        this.syncUi();
        this.updateHiddenInputs();
      } catch (error) {
        live.hidden = true;
        fallback.hidden = false;
        fallback.querySelectorAll('input').forEach((input) => {
          input.disabled = false;
        });
      }
    }

    escape(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    async submitAddressForm(form) {
      const submit = form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          body: new FormData(form),
          credentials: 'same-origin',
        });
        if (!response.ok && response.status >= 500) throw new Error('save');
        const url = new URL(window.location.href);
        url.hash = 'KarthikaDeliveryGift';
        window.location.assign(url.toString());
        window.location.reload();
      } catch (error) {
        this.showError(this.dataset.errorSave || 'Could not save that address. Try again.');
        if (submit) submit.disabled = false;
      }
    }

    async deleteAddress(button) {
      const message = button.dataset.confirmMessage || 'Delete this address?';
      if (!window.confirm(message)) return;
      const target = button.dataset.target;
      const token = this.querySelector('[name="authenticity_token"]')?.value;
      if (!target) return;
      try {
        const body = new FormData();
        body.append('_method', 'delete');
        body.append('form_type', 'customer_address');
        if (token) body.append('authenticity_token', token);
        const response = await fetch(target, { method: 'POST', body, credentials: 'same-origin' });
        if (!response.ok) throw new Error('delete');
        const url = new URL(window.location.href);
        url.hash = 'KarthikaDeliveryGift';
        window.location.assign(url.toString());
        window.location.reload();
      } catch (error) {
        this.showError(this.dataset.errorSave || 'Could not delete that address. Try again.');
      }
    }

    static bindCheckoutOnce() {
      if (KarthikaDeliveryGift.checkoutBound) return;
      KarthikaDeliveryGift.checkoutBound = true;
      document.addEventListener(
        'click',
        async (event) => {
          const button = event.target.closest('[name="checkout"]');
          if (!button || button.disabled) return;
          const roots = [...document.querySelectorAll('karthika-delivery-gift')];
          if (!roots.length) return;
          const root = roots.find((node) => node.dataset.compact !== 'true') || roots[0];
          if (root.compact) {
            const savedAddress = root.querySelector('[data-kdg-attr="Delivery address"]')?.value;
            if (!savedAddress) {
              event.preventDefault();
              window.location.href = `${window.routes?.cart_url || '/cart'}#KarthikaDeliveryGift`;
            }
            return;
          }
          root.syncUi();
          const error = root.validate();
          if (error) {
            event.preventDefault();
            root.showError(error);
            root.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
          }
          event.preventDefault();
          button.disabled = true;
          try {
            await root.persist();
            const form = button.form || document.getElementById(button.getAttribute('form') || root.formId);
            if (!form) return;
            if (!form.querySelector('input[name="checkout"]')) {
              const input = document.createElement('input');
              input.type = 'hidden';
              input.name = 'checkout';
              input.value = '';
              form.appendChild(input);
            }
            form.submit();
          } catch (err) {
            button.disabled = false;
            root.showError(root.dataset.errorSave || 'Could not save delivery details. Try again.');
          }
        },
        true
      );
    }
  }

  if (!customElements.get('karthika-delivery-gift')) {
    customElements.define('karthika-delivery-gift', KarthikaDeliveryGift);
  }
})();
