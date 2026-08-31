/**
 * Newest-first cart line order via hidden cart attribute `_cart_line_order`.
 * Line item properties are not used — unique properties would split the same variant into extra lines.
 */
window.CartItemOrder = {
  ATTRIBUTE: '_cart_line_order',
  _queue: Promise.resolve(),
  _lastCart: null,

  sortItems(items, attributes) {
    if (!Array.isArray(items)) return [];
    const order = String(attributes?.[this.ATTRIBUTE] || '')
      .split('|')
      .map((key) => key.trim())
      .filter(Boolean);

    return [...items].sort((a, b) => {
      const indexA = order.indexOf(a.key);
      const indexB = order.indexOf(b.key);
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return items.indexOf(b) - items.indexOf(a);
    });
  },

  parentItems(cart) {
    return (cart?.items || []).filter((item) => !item.parent_relationship?.parent);
  },

  parseOrder(value) {
    return String(value || '')
      .split('|')
      .map((key) => key.trim())
      .filter(Boolean);
  },

  /**
   * Previous order keys are kept even when missing from this snapshot, so a stale
   * cart fetch cannot drop keys written by an earlier promote in the same session.
   * Prune only when this cart clearly includes the line being promoted.
   */
  nextOrder(cart, promotedKey) {
    const parentKeys = this.parentItems(cart).map((item) => item.key);
    const previous = this.parseOrder(cart?.attributes?.[this.ATTRIBUTE]).filter(
      (key) => key !== promotedKey
    );
    const snapshotIsComplete = parentKeys.includes(promotedKey);
    const keptPrevious = snapshotIsComplete
      ? previous.filter((key) => parentKeys.includes(key))
      : previous;
    const recorded = new Set([promotedKey, ...keptPrevious]);
    const unrecordedNewestFirst = parentKeys.filter((key) => !recorded.has(key)).reverse();
    return [promotedKey, ...keptPrevious, ...unrecordedNewestFirst].filter(Boolean);
  },

  snapshotForPromote(fresh, hint) {
    const last = this._lastCart;
    return {
      ...(fresh || hint || last || {}),
      items: fresh?.items || hint?.items || last?.items || [],
      attributes: Object.assign({}, last?.attributes, hint?.attributes, fresh?.attributes, {
        [this.ATTRIBUTE]:
          last?.attributes?.[this.ATTRIBUTE] ||
          fresh?.attributes?.[this.ATTRIBUTE] ||
          hint?.attributes?.[this.ATTRIBUTE] ||
          '',
      }),
    };
  },

  async fetchCart() {
    const cartUrl = `${window.routes?.cart_url || '/cart'}.js`;
    try {
      const response = await fetch(cartUrl, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      return null;
    }
  },

  enqueue(work) {
    const run = this._queue.then(work, work);
    this._queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  },

  async writeOrder(cart, orderKeys, options = {}, lineKey) {
    const body = {
      attributes: Object.assign({}, cart.attributes || {}, {
        [this.ATTRIBUTE]: orderKeys.join('|'),
      }),
    };

    if (options.sections) {
      body.sections = options.sections;
      body.sections_url = options.sections_url || window.location.pathname;
    }

    const updateUrl = window.routes?.cart_update_url || '/cart/update.js';
    const config =
      typeof fetchConfig === 'function'
        ? fetchConfig('javascript')
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          };

    try {
      const response = await fetch(updateUrl, { ...config, body: JSON.stringify(body) });
      if (!response.ok) return cart;
      const updated = await response.json();
      if (!updated || updated.errors || updated.status) return cart;
      if (lineKey && !updated.key) updated.key = lineKey;
      this._lastCart = updated;
      return updated;
    } catch (e) {
      return cart;
    }
  },

  /**
   * Moves the given line key to the top of the persisted cart order.
   * Optionally re-requests sections for drawer/page re-render.
   */
  promoteLine(cart, lineKey, options = {}) {
    if (!lineKey) return Promise.resolve(cart);

    return this.enqueue(async () => {
      const fresh = await this.fetchCart();
      const snapshot = this.snapshotForPromote(fresh, cart);
      const order = this.nextOrder(snapshot, lineKey);
      return this.writeOrder(snapshot, order, options, lineKey);
    });
  },

  /**
   * Apply several newly added keys at once (last key in the array = newest / first).
   * Used after sequential bulk adds so intermediate cart fetches cannot drop order keys.
   */
  promoteKeys(keysNewestFirst, options = {}) {
    const keys = (keysNewestFirst || []).filter(Boolean);
    if (!keys.length) return Promise.resolve(null);

    return this.enqueue(async () => {
      const fresh = await this.fetchCart();
      const snapshot = this.snapshotForPromote(fresh, this._lastCart);
      const working = {
        ...snapshot,
        attributes: Object.assign({}, snapshot.attributes),
      };
      for (const key of [...keys].reverse()) {
        working.attributes[this.ATTRIBUTE] = this.nextOrder(working, key).join('|');
      }
      return this.writeOrder(
        working,
        this.parseOrder(working.attributes[this.ATTRIBUTE]),
        options,
        keys[0]
      );
    });
  },

  async promoteFromAddResponse(addResponse, options = {}) {
    if (!addResponse || addResponse.status || !addResponse.key) {
      return addResponse;
    }

    let cart = addResponse.items ? addResponse : null;
    if (!cart) {
      cart = await this.fetchCart();
      if (!cart) return addResponse;
    }

    const updated = await this.promoteLine(cart, addResponse.key, options);
    if (updated && !updated.key) updated.key = addResponse.key;
    return updated || addResponse;
  },
};
