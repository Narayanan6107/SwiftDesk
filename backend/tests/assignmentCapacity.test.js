const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isAgentCapacityEligible,
  getAgentCapacityStatus,
  buildCapacityLogEntry,
  getEligibleEngineers,
} = require('../services/assignmentEngine');
const { normalizePriority, getPriorityRank, getPrioritySortValue } = require('../config/automation');

test('marks an engineer as ineligible once workload reaches capacity', () => {
  const agent = { name: 'Priya', active_tickets: 3, max_capacity: 3, status: 'busy' };

  assert.equal(isAgentCapacityEligible(agent), false);
  assert.deepEqual(getAgentCapacityStatus(agent), {
    eligible: false,
    availableSlots: 0,
    status: 'busy',
  });
});

test('keeps engineers eligible while they still have capacity', () => {
  const agent = { name: 'Meera', active_tickets: 2, max_capacity: 4, status: 'available' };

  assert.equal(isAgentCapacityEligible(agent), true);
  assert.deepEqual(getAgentCapacityStatus(agent), {
    eligible: true,
    availableSlots: 2,
    status: 'available',
  });
});

test('builds a capacity log entry with the reason for ineligibility', () => {
  const agent = { name: 'Vikram', active_tickets: 3, max_capacity: 3, status: 'busy' };
  const entry = buildCapacityLogEntry(agent, 'Capacity reached');

  assert.match(entry, /\[CAPACITY CHECK\]/);
  assert.match(entry, /Engineer: Vikram/);
  assert.match(entry, /Eligible: false/);
  assert.match(entry, /Reason: Capacity reached/);
});

test('normalizes legacy critical priorities to high and orders queue by priority rank and age', () => {
  assert.equal(normalizePriority('Critical'), 'High');
  assert.equal(normalizePriority('critical'), 'High');
  assert.equal(getPriorityRank('High'), 3);
  assert.equal(getPriorityRank('Medium'), 2);
  assert.equal(getPriorityRank('Low'), 1);

  const queued = [
    { ticketId: 'H2', createdAt: '2024-01-01T10:05:00.000Z', priority: 'High' },
    { ticketId: 'M1', createdAt: '2024-01-01T09:55:00.000Z', priority: 'Medium' },
    { ticketId: 'H1', createdAt: '2024-01-01T10:00:00.000Z', priority: 'High' },
    { ticketId: 'L1', createdAt: '2024-01-01T08:00:00.000Z', priority: 'Low' },
  ];

  const ordered = [...queued].sort(getPrioritySortValue);
  assert.deepEqual(ordered.map((item) => item.ticketId), ['H1', 'H2', 'M1', 'L1']);
});

test('normalizes legacy critical values before evaluating engineer eligibility', () => {
  const engineers = [
    { name: 'Asha', level: 'L3', isActive: true, status: 'available', active_tickets: 0, max_capacity: 3, skills: ['General'] },
    { name: 'Bharat', level: 'L2', isActive: true, status: 'available', active_tickets: 0, max_capacity: 3, skills: ['General'] },
  ];

  const eligible = getEligibleEngineers('Critical', engineers);
  assert.deepEqual(eligible.map((engineer) => engineer.name), ['Asha']);
});
