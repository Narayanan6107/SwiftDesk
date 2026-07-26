const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeCustomerDetails, validateCustomerDetails } = require('../services/customerDetails');

test('merges JWT identity with request overrides and normalizes the result', () => {
  const merged = mergeCustomerDetails(
    { name: 'Ada Lovelace', email: 'ada@example.com' },
    { name: 'Grace Hopper', email: 'grace@example.com' }
  );

  assert.deepEqual(merged, { name: 'Grace Hopper', email: 'grace@example.com' });
});

test('requires a final name and a valid email address', () => {
  const result = validateCustomerDetails({ name: '   ', email: 'not-an-email' });

  assert.equal(result.valid, false);
  assert.equal(result.errors.name, 'Customer name is required');
  assert.equal(result.errors.email, 'Customer email is not a valid email address');
});
