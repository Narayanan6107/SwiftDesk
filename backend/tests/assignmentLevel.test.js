const test = require('node:test');
const assert = require('node:assert/strict');

const { selectEngineerForTicket } = require('../services/assignmentEngine');
const { getRequiredSupportLevel } = require('../config/automation');

function engineer(overrides) {
  return {
    _id: overrides._id || overrides.name,
    name: overrides.name,
    level: overrides.level,
    isActive: true,
    status: 'available',
    active_tickets: overrides.active_tickets ?? 0,
    max_capacity: overrides.max_capacity ?? 5,
    skills: overrides.skills ?? ['General'],
  };
}

test('Case 1: Low priority assigns to L1 when available', () => {
  const pool = [
    engineer({ name: 'L1-A', level: 'L1' }),
    engineer({ name: 'L3-A', level: 'L3', skills: ['Technical', 'Network'] }),
  ];

  const result = selectEngineerForTicket(pool, 'Low', 'General');
  assert.equal(result.engineer.name, 'L1-A');
  assert.equal(result.requiredLevel, 'L1');
  assert.equal(result.assignedLevel, 'L1');
});

test('Case 2: Medium priority assigns to L2', () => {
  const pool = [
    engineer({ name: 'L1-A', level: 'L1' }),
    engineer({ name: 'L2-A', level: 'L2' }),
    engineer({ name: 'L3-A', level: 'L3' }),
  ];

  const result = selectEngineerForTicket(pool, 'Medium', 'Technical');
  assert.equal(result.engineer.name, 'L2-A');
  assert.equal(result.requiredLevel, 'L2');
  assert.equal(result.assignedLevel, 'L2');
});

test('Case 3: High priority network issue assigns to L3 with matching skills', () => {
  const pool = [
    engineer({ name: 'L1-Net', level: 'L1', skills: ['Network'] }),
    engineer({ name: 'L3-Net', level: 'L3', skills: ['Network', 'Technical'] }),
  ];

  const result = selectEngineerForTicket(pool, 'High', 'Network Issue');
  assert.equal(result.engineer.name, 'L3-Net');
  assert.equal(result.requiredLevel, 'L3');
  assert.equal(result.assignedLevel, 'L3');
  assert.match(result.assignmentReason, /High priority/i);
});

test('Case 4: Critical priority requires L3 senior escalation', () => {
  const pool = [
    engineer({ name: 'L2-A', level: 'L2' }),
    engineer({ name: 'L3-Senior', level: 'L3' }),
  ];

  const result = selectEngineerForTicket(pool, 'Critical', 'Technical');
  assert.equal(result.engineer.name, 'L3-Senior');
  assert.equal(getRequiredSupportLevel('Critical'), 'L3');
  assert.match(result.assignmentReason, /senior escalation/i);
});

test('Case 5: No available engineer returns null selection and preserves required level', () => {
  const pool = [
    engineer({ name: 'L1-Busy', level: 'L1', active_tickets: 5, max_capacity: 5, status: 'busy' }),
    engineer({ name: 'L2-Offline', level: 'L2', status: 'offline' }),
  ];

  const result = selectEngineerForTicket(pool, 'Medium', 'Billing');
  assert.equal(result.engineer, null);
  assert.equal(result.requiredLevel, 'L2');
  assert.equal(result.selectedEngineer, null);
});

test('Low priority does not assign L3 while L1 is available', () => {
  const pool = [
    engineer({ name: 'L1-Free', level: 'L1', active_tickets: 0 }),
    engineer({ name: 'L3-Free', level: 'L3', active_tickets: 0 }),
  ];

  const result = selectEngineerForTicket(pool, 'Low', 'General');
  assert.equal(result.assignedLevel, 'L1');
});

test('High priority never assigns L1 even if L1 has network skills', () => {
  const pool = [
    engineer({ name: 'L1-Net', level: 'L1', skills: ['Network'] }),
  ];

  const result = selectEngineerForTicket(pool, 'High', 'Network Issue');
  assert.equal(result.engineer, null);
  assert.equal(result.requiredLevel, 'L3');
});
