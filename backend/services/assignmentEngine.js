/**
 * Assignment Engine
 *
 * Implements the core logic for matching a ticket to the best available agent:
 *   1. Map the ticket's resolved priority to the minimum support level required.
 *   2. Find all agents whose level can handle that priority.
 *   3. Filter out agents that are offline or at max capacity.
 *   4. Among eligible agents, pick the one with:
 *        a. Fewest active_tickets (lowest workload)
 *        b. Oldest lastAssignedAt (longest idle time) — tie-break
 *   5. Atomically update the chosen agent (active_tickets++, lastAssignedAt).
 *   6. Return the assignment result, or null if no agent is available.
 */

const SupportAgent = require('../models/SupportAgent');
const { LEVEL_CAPABILITIES, PRIORITY_MIN_LEVEL } = require('../config/automation');

/**
 * Returns the set of level strings that are eligible for a given priority.
 *
 * e.g. priority='Medium' → ['L2', 'L3']
 *      priority='Critical' → ['L3']
 */
function _eligibleLevels(priority) {
  return Object.entries(LEVEL_CAPABILITIES)
    .filter(([, caps]) => caps.includes(priority))
    .map(([level]) => level);
}

/**
 * Find the best agent for a ticket with the given resolved priority.
 *
 * @param {string} priority - 'Low' | 'Medium' | 'High' | 'Critical'
 * @returns {Promise<{ agent: SupportAgentDoc, assignedLevel: string } | null>}
 */
async function findAndAssign(priority) {
  const levels = _eligibleLevels(priority);
  if (!levels.length) return null;

  // Find all eligible, available, non-full agents in one query
  const candidates = await SupportAgent.find({
    level: { $in: levels },
    status: { $in: ['available', 'busy'] }, // 'busy' = has work but still accepts
    isActive: true,
    $expr: { $lt: ['$active_tickets', '$max_capacity'] },
  })
    .sort({
      active_tickets: 1,         // prefer least loaded
      lastAssignedAt: 1,         // tie-break: longest idle (null sorts first in Mongo asc)
    })
    .limit(1);

  if (!candidates.length) return null;

  const agent = candidates[0];

  // Atomically update agent workload so concurrent requests don't double-assign
  const updated = await SupportAgent.findByIdAndUpdate(
    agent._id,
    {
      $inc: { active_tickets: 1 },
      $set: {
        lastAssignedAt: new Date(),
        status: agent.active_tickets + 1 >= agent.max_capacity ? 'busy' : 'available',
      },
    },
    { new: true }
  );

  if (!updated) return null; // race condition safeguard

  return {
    agent: updated,
    assignedLevel: updated.level,
  };
}

/**
 * Release a ticket back from an agent (called on resolve/close).
 *
 * @param {ObjectId} agentId
 */
async function releaseTicket(agentId) {
  if (!agentId) return;

  await SupportAgent.findByIdAndUpdate(agentId, [
    {
      $set: {
        active_tickets: { $max: [0, { $subtract: ['$active_tickets', 1] }] },
        status: {
          $cond: {
            if: { $lte: [{ $subtract: ['$active_tickets', 1] }, 0] },
            then: 'available',
            else: '$status',
          },
        },
      },
    },
  ]);
}

module.exports = { findAndAssign, releaseTicket, _eligibleLevels };
