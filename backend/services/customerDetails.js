function mergeCustomerDetails(jwtCustomer = {}, requestCustomer = {}) {
  const merged = {
    name: requestCustomer?.name?.trim() || jwtCustomer?.name?.trim() || '',
    email: requestCustomer?.email?.trim() || jwtCustomer?.email?.trim() || '',
  };

  if (requestCustomer?.name === undefined && jwtCustomer?.name !== undefined) {
    merged.name = jwtCustomer.name.trim();
  }

  if (requestCustomer?.email === undefined && jwtCustomer?.email !== undefined) {
    merged.email = jwtCustomer.email.trim();
  }

  return {
    name: merged.name.trim(),
    email: merged.email.toLowerCase().trim(),
  };
}

function validateCustomerDetails(customer) {
  const errors = {};
  const normalized = {
    name: String(customer?.name || '').trim(),
    email: String(customer?.email || '').trim().toLowerCase(),
  };

  if (!normalized.name) {
    errors.name = 'Customer name is required';
  }

  if (!/^\S+@\S+\.\S+$/.test(normalized.email)) {
    errors.email = 'Customer email is not a valid email address';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: normalized,
  };
}

module.exports = {
  mergeCustomerDetails,
  validateCustomerDetails,
};
