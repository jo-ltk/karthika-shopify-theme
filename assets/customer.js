const selectors = {
  customerAddresses: '[data-customer-addresses]',
  addressCountrySelect: '[data-address-country-select]',
  addressContainer: '[data-address]',
  toggleAddressButton: 'button[aria-expanded][aria-controls]',
  cancelAddressButton: 'button[type="reset"]',
  deleteAddressButton: 'button[data-confirm-message]',
};

const attributes = {
  expanded: 'aria-expanded',
  confirmMessage: 'data-confirm-message',
};

class CustomerAddresses {
  constructor() {
    this.elements = this._getElements();
    if (Object.keys(this.elements).length === 0) return;
    this._revealInvalidForms();
    this._setupCountries();
    this._setupEventListeners();
  }

  _getElements() {
    const container = document.querySelector(selectors.customerAddresses);
    return container
      ? {
          container,
          toggleButtons: container.querySelectorAll(selectors.toggleAddressButton),
          cancelButtons: container.querySelectorAll(selectors.cancelAddressButton),
          deleteButtons: container.querySelectorAll(selectors.deleteAddressButton),
          countrySelects: container.querySelectorAll(selectors.addressCountrySelect),
        }
      : {};
  }

  _panelFor(button) {
    const id = button.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  }

  _setExpanded(button, expanded) {
    button.setAttribute(attributes.expanded, String(expanded));
    const panel = this._panelFor(button);
    if (panel) panel.hidden = !expanded;
  }

  _revealInvalidForms() {
    this.elements.toggleButtons.forEach((button) => {
      const panel = this._panelFor(button);
      if (panel && panel.querySelector('[role="alert"]')) {
        this._setExpanded(button, true);
      }
    });
  }

  _setupCountries() {
    if (typeof Shopify === 'undefined' || !Shopify.CountryProvinceSelector) return;

    this.elements.countrySelects.forEach((select) => {
      const formId = select.dataset.formId;
      if (!formId) return;
      new Shopify.CountryProvinceSelector(`AddressCountry_${formId}`, `AddressProvince_${formId}`, {
        hideElement: `AddressProvinceContainer_${formId}`,
      });
    });
  }

  _setupEventListeners() {
    this.elements.toggleButtons.forEach((element) => {
      element.addEventListener('click', this._handleAddEditButtonClick);
    });
    this.elements.cancelButtons.forEach((element) => {
      element.addEventListener('click', this._handleCancelButtonClick);
    });
    this.elements.deleteButtons.forEach((element) => {
      element.addEventListener('click', this._handleDeleteButtonClick);
    });
  }

  _handleAddEditButtonClick = ({ currentTarget }) => {
    const expanded = currentTarget.getAttribute(attributes.expanded) === 'true';
    this._setExpanded(currentTarget, !expanded);
  };

  _handleCancelButtonClick = ({ currentTarget }) => {
    const panel =
      currentTarget.closest('.karthika-address-form') || currentTarget.closest(selectors.addressContainer);
    if (!panel || !panel.id) return;
    const toggle = this.elements.container.querySelector(`[aria-controls="${panel.id}"]`);
    if (toggle) this._setExpanded(toggle, false);
  };

  _handleDeleteButtonClick = ({ currentTarget }) => {
    if (!confirm(currentTarget.getAttribute(attributes.confirmMessage))) return;
    if (typeof Shopify === 'undefined' || typeof Shopify.postLink !== 'function') return;
    Shopify.postLink(currentTarget.dataset.target, {
      parameters: { _method: 'delete' },
    });
  };
}

document.addEventListener('DOMContentLoaded', () => new CustomerAddresses());
