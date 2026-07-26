/**
 * Assignment Engine
 *
 * Matches tickets to engineers using ML-resolved priority and category:
 *   1. Map predicted priority → required support level (strict tier rules).
 *   2. Filter by category/skills, availability, and capacity.
 *   3. Prefer the lowest sufficient tier (e.g. L1 for Low before L3 fallback).
 *   4. Atomically increment workload on the chosen engineer.
 */

const SupportAgent = require('../models/SupportAgent');
const {
  getRequiredSupportLevel,
  getLevelPreferenceOrder,
  resolvePredictedPriority,
  engineerMatchesCategory,
} = require('../config/automation');
const { callMLAssignment } = require('./mlClassifier');
const {
  logAssignmentSuccess,
  logAssignmentDecision,
  logDebugAssignment,
} = require('./assignmentLogger');

function getAgentCapacityStatus(agent) {
  const activeTickets = Number(agent?.active_tickets ?? 0);
  const maxCapacity = Number(agent?.max_capacity ?? 1);
  const availableSlots = Math.max(0, maxCapacity - activeTickets);
  const status = agent?.status === 'offline'
    ? 'offline'
    : activeTickets >= maxCapacity
      ? 'busy'
      : 'available';

  return {
    eligible: Boolean(agent?.isActive !== false && agent?.status === 'available' && activeTickets < maxCapacity),
    availableSlots,
    status,
  };
}

function isAgentCapacityEligible(agent) {
  return getAgentCapacityStatus(agent).eligible;
}

function buildCapacityLogEntry(agent, reason) {
  const capacityStatus = getAgentCapacityStatus(agent);
  return [
    '[CAPACITY CHECK]',
    `Engineer: ${agent.name}`,
    `Current: ${agent.active_tickets}`,
    `Capacity: ${agent.max_capacity}`,
    `Eligible: ${capacityStatus.eligible}`,
    `Reason: ${reason}`,
  ].join('\n');
}

function computeAgentStatus(agent) {
  if (agent?.status === 'offline') return 'offline';
  return agent?.active_tickets >= agent?.max_capacity ? 'busy' : 'available';
}

function isEngineerAssignable(engineer) {
  if (engineer?.isActive === false) return false;
  if (engineer?.status !== 'available') return false;
  if (Number(engineer.active_tickets) >= Number(engineer.max_capacity)) return false;
  return true;
}

function rankEligibleEngineers(engineers) {
  return [...engineers].sort((left, right) => {
    const leftRatio = left.max_capacity > 0 ? left.active_tickets / left.max_capacity : 1;
    const rightRatio = right.max_capacity > 0 ? right.active_tickets / right.max_capacity : 1;
    if (leftRatio !== rightRatio) return leftRatio - rightRatio;
    if (left.active_tickets !== right.active_tickets) return left.active_tickets - right.active_tickets;
    return new Date(left.lastAssignedAt || 0) - new Date(right.lastAssignedAt || 0);
  });
}

/**
 * Pure selection logic — used by findAndAssign and unit tests.
 */
function selectEngineerForTicket(allEngineers, priority, category = null) {
  const resolved = resolvePredictedPriority(priority);
  const requiredLevel = getRequiredSupportLevel(resolved.value);
  const levelOrder = getLevelPreferenceOrder(resolved.value);

  const skillMatched = allEngineers.filter(
    (engineer) => isEngineerAssignable(engineer) && engineerMatchesCategory(engineer, category)
  );

  const availableEngineers = skillMatched.map((engineer) => ({
    id: engineer._id?.toString?.() || engineer.id,
    name: engineer.name,
    level: engineer.level,
    active_tickets: engineer.active_tickets,
    max_capacity: engineer.max_capacity,
  }));

  for (const level of levelOrder) {
    const atLevel = skillMatched.filter((engineer) => engineer.level === level);
    if (!atLevel.length) continue;

    const ranked = rankEligibleEngineers(atLevel);
    const selected = ranked[0];
    const assignmentReason = buildAssignmentReason({
      priority: resolved.value,
      requiredLevel,
      assignedLevel: selected.level,
      category,
      fallbackTier: level !== requiredLevel,
    });

    return {
      engineer: selected,
      requiredLevel,
      assignedLevel: selected.level,
      assignmentReason,
      availableEngineers,
      selectedEngineer: {
        id: selected._id?.toString?.() || selected.id,
        name: selected.name,
        level: selected.level,
      },
    };
  }

  return {
    engineer: null,
    requiredLevel,
    assignedLevel: null,
    assignmentReason: null,
    availableEngineers,
    selectedEngineer: null,
  };
}

function buildAssignmentReason({ priority, requiredLevel, assignedLevel, category, fallbackTier }) {
  const categoryPart = category ? `${category} ` : '';
  if (priority === 'High') {
    return `High priority ${categoryPart}issue requires ${requiredLevel} (L3) engineer`;
  }
  if (fallbackTier && priority === 'Low' && assignedLevel === 'L3') {
    return `Low priority ticket — no L1/L2 engineers available; assigned to L3`;
  }
  if (fallbackTier && priority === 'Low' && assignedLevel === 'L2') {
    return `Low priority ticket — no L1 engineers available; assigned to L2`;
  }
  if (fallbackTier && priority === 'Medium' && assignedLevel === 'L3') {
    return `Medium priority ticket — no L2 engineers available; assigned to L3`;
  }
  return `${priority} priority ${categoryPart}ticket assigned to ${assignedLevel} engineer`;
}

/** @deprecated Use selectEngineerForTicket — kept for existing capacity tests. */
function getEligibleEngineers(priority, allEngineers = []) {
  const levelOrder = getLevelPreferenceOrder(priority);
  const allowedLevels = new Set(levelOrder);
  return allEngineers.filter((engineer) => {
    if (!isEngineerAssignable(engineer)) return false;
    return allowedLevels.has(engineer.level);
  });
}

async function tryAssignToEngineer(agentId) {
  const updated = await SupportAgent.findOneAndUpdate(
    {
      _id: agentId,
      isActive: true,
      status: 'available',
      $expr: { $lt: ['$active_tickets', '$max_capacity'] },
    },
    {
      $inc: { active_tickets: 1 },
      $set: { lastAssignedAt: new Date() },
    },
    { new: true }
  );

  if (updated) {
    const nextStatus = updated.active_tickets >= updated.max_capacity ? 'busy' : 'available';
    const reloaded = await SupportAgent.findByIdAndUpdate(
      agentId,
      { $set: { status: nextStatus } },
      { new: true }
    );
    logDebugAssignment(buildCapacityLogEntry(reloaded || updated, 'Assigned successfully'));
    return reloaded || updated;
  }

  logDebugAssignment(`[CAPACITY CHECK]\nEngineer: ${agentId}\nCurrent: n/a\nCapacity: n/a\nEligible: false\nReason: Capacity reached during atomic assignment`);
  return null;
}

async function findAndAssign(priority, ticketId = 'TKT-GENERIC', options = {}) {
  const category = options.category ?? null;
  lastAssignmentTimestamp = new Date();

  const resolved = resolvePredictedPriority(priority);
  const requiredLevel = getRequiredSupportLevel(resolved.value);

  logDebugAssignment(
    `[DEBUG] Assignment flow start ticket=${ticketId} priority=${resolved.value} requiredLevel=${requiredLevel} category=${category || 'n/a'}`
  );

  const allEngineers = await SupportAgent.find({ isActive: true }).sort({ name: 1 });
  let selection = selectEngineerForTicket(allEngineers, resolved.value, category);

  logAssignmentDecision({
    ticketId,
    requiredLevel: selection.requiredLevel,
    availableEngineers: selection.availableEngineers,
    selectedEngineer: selection.selectedEngineer,
  });

  if (!selection.engineer) {
    return null;
  }

  const mlResult = await callMLAssignment(ticketId, resolved.value, [selection.engineer]);
  let agentToAssign = selection.engineer;

  if (mlResult?.success && mlResult.engineerId) {
    const mlAgent = await SupportAgent.findById(mlResult.engineerId);
    if (
      mlAgent
      && mlAgent.level === selection.engineer.level
      && isEngineerAssignable(mlAgent)
      && engineerMatchesCategory(mlAgent, category)
    ) {
      agentToAssign = mlAgent;
    }
  }

  const workloadRatio = agentToAssign.max_capacity > 0
    ? agentToAssign.active_tickets / agentToAssign.max_capacity
    : 1;

  logAssignmentSuccess(
    ticketId,
    agentToAssign.name,
    agentToAssign.level,
    'Rules',
    `${agentToAssign.active_tickets}/${agentToAssign.max_capacity}`
  );
  logDebugAssignment(
    `[ASSIGNMENT DEBUG] Ticket ${ticketId} Priority ${resolved.value} Required Level ${requiredLevel} Workload Ratio ${workloadRatio}`
  );

  const updated = await tryAssignToEngineer(agentToAssign._id);
  if (!updated) return null;

  lastAssignedTicketId = ticketId;

  return {
    agent: updated,
    assignedLevel: updated.level,
    requiredLevel,
    assignmentReason: selection.assignmentReason,
  };
}

let lastAssignmentTimestamp = new Date();

async function releaseTicket(agentId) {
  if (!agentId) return;

  const agent = await SupportAgent.findById(agentId);
  if (!agent) return;

  const nextActiveTickets = Math.max(0, agent.active_tickets - 1);
  const nextStatus = agent.status === 'offline' ? 'offline' : nextActiveTickets >= agent.max_capacity ? 'busy' : 'available';

  await SupportAgent.findByIdAndUpdate(agentId, {
    $set: {
      active_tickets: nextActiveTickets,
      status: nextStatus,
    },
  });
}

let lastAssignedTicketId = null;

function getLastAssignmentTimestamp() {
  return lastAssignmentTimestamp;
}

function getLastAssignedTicketId() {
  return lastAssignedTicketId;
}

module.exports = {
  findAndAssign,
  releaseTicket,
  getLastAssignmentTimestamp,
  getLastAssignedTicketId,
  isAgentCapacityEligible,
  getAgentCapacityStatus,
  buildCapacityLogEntry,
  computeAgentStatus,
  getEligibleEngineers,
  rankEligibleEngineers,
  tryAssignToEngineer,
  selectEngineerForTicket,
  buildAssignmentReason,
};
