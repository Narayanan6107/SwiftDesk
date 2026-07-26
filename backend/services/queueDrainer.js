/**
 * Queue Drainer Service
 *
 * Triggered immediately when an engineer's capacity is freed (ticket resolved/closed).
 * Finds the highest-priority queued ticket that this engineer's level can handle
 * and assigns it — ensuring L3 engineers always pick up High tickets before Medium/Low.
 *
 * Priority ordering enforced: High > Medium > Low, FIFO within same priority.
 * L3 engineers: High tickets are always preferred first.
 * L2 engineers: Medium tickets before Low.
 * L1 engineers: Low tickets only.
 */

const Ticket = require('../models/Ticket');
const AuditLog = require('../models/AuditLog');
const SupportAgent = require('../models/SupportAgent');
const { tryAssignToEngineer } = require('./assignmentEngine');
const { logAssignmentSuccess, logAssignmentFailed } = require('./assignmentLogger');

/**
 * Priority ranks for queue sorting — High is highest priority.
 */
const PRIORITY_RANK = { High: 3, Medium: 2, Low: 1 };

/**
 * Tickets that each level is capable of handling.
 * This drives what gets dequeued for a given engineer.
 */
const LEVEL_CAPABILITIES = {
  L1: ['Low'],
  L2: ['Low', 'Medium'],
  L3: ['Low', 'Medium', 'High'],
};

/**
 * When given a newly freed L3 engineer, prefer High tickets above all else.
 * Defines the order in which priorities are tried when scanning the queue.
 */
const LEVEL_PRIORITY_PREFERENCE = {
  L1: ['Low'],
  L2: ['Medium', 'Low'],
  L3: ['High', 'Medium', 'Low'], // L3 drains High first, then Medium, then Low
};

/**
 * Drain the queue for a specific agent — assign the top-priority eligible
 * queued ticket to this agent immediately without waiting for the cron job.
 *
 * @param {string|ObjectId} agentId - The agent's MongoDB _id
 * @returns {Promise<{ assigned: boolean, ticketId?: string, priority?: string }>}
 */
async function drainQueueForAgent(agentId) {
  if (!agentId) return { assigned: false };

  // Re-fetch agent to get current capacity
  const agent = await SupportAgent.findById(agentId);
  if (!agent || !agent.isActive) return { assigned: false };
  if (agent.active_tickets >= agent.max_capacity) return { assigned: false };
  if (agent.status === 'offline') return { assigned: false };

  const capablePriorities = LEVEL_CAPABILITIES[agent.level] || [];
  if (!capablePriorities.length) return { assigned: false };

  // Preference order for this agent's level (High first for L3, etc.)
  const preferenceOrder = LEVEL_PRIORITY_PREFERENCE[agent.level] || capablePriorities;

  // Search the queue in preference order — take the first match per priority tier
  for (const priority of preferenceOrder) {
    // Find the oldest queued ticket at this priority that is Open and queued
    const ticket = await Ticket.findOne({
      isQueued: true,
      status: 'New',
      assignedAgent: null,
      $or: [
        { aiPriority: priority },
        { predictedPriority: priority },
        { priority: priority },
      ],
    }).sort({ queuedAt: 1, createdAt: 1 }); // FIFO within same priority

    if (!ticket) continue;

    // Atomically claim capacity on the agent
    const updatedAgent = await tryAssignToEngineer(agentId);
    if (!updatedAgent) {
      // Agent is no longer available (race condition)
      return { assigned: false };
    }

    // Assign the ticket
    ticket.assignedAgent = updatedAgent._id;
    ticket.assignedEngineer = updatedAgent._id;
    ticket.assignedLevel = updatedAgent.level;
    ticket.status = 'Assigned';
    ticket.isQueued = false;
    ticket.queuedAt = null;
    ticket.assignmentTimestamp = new Date();
    ticket.assignmentReason = `Queue drain: ${priority} priority ticket assigned to available ${updatedAgent.level} engineer`;
    await ticket.save();

    logAssignmentSuccess(ticket.ticketId, updatedAgent.name, updatedAgent.level, 'QueueDrain',
      `${updatedAgent.active_tickets}/${updatedAgent.max_capacity}`);

    await AuditLog.create({
      ticket: ticket._id,
      ticketId: ticket.ticketId,
      eventType: 'queue_drained',
      details: {
        agentId: updatedAgent.agent_id,
        agentName: updatedAgent.name,
        agentLevel: updatedAgent.level,
        ticketPriority: priority,
        trigger: 'engineer_capacity_freed',
      },
      performedBy: 'queue_drainer',
    });

    // Send assignment notification in background
    try {
      const Customer = require('../models/Customer');
      const customer = await Customer.findById(ticket.customer);
      if (customer) {
        const { notifyTicketAssigned } = require('./notificationService');
        notifyTicketAssigned(ticket, customer, updatedAgent).catch(err =>
          console.error('[QueueDrainer] Notification error:', err.message)
        );
      }
    } catch (notifErr) {
      console.error('[QueueDrainer] Notification error:', notifErr.message);
    }

    console.log(`[QUEUE DRAIN] Assigned queued ticket ${ticket.ticketId} (${priority}) to ${updatedAgent.name} (${updatedAgent.level})`);
    return { assigned: true, ticketId: ticket.ticketId, priority };
  }

  return { assigned: false };
}

/**
 * Drain the queue for all currently available agents.
 * Used at startup to ensure no queued tickets are left idle.
 *
 * @returns {Promise<number>} Number of tickets assigned
 */
async function drainQueueForAllAvailableAgents() {
  const availableAgents = await SupportAgent.find({
    isActive: true,
    status: 'available',
    $expr: { $lt: ['$active_tickets', '$max_capacity'] },
  }).sort({ active_tickets: 1 }); // Least loaded first

  let totalAssigned = 0;
  for (const agent of availableAgents) {
    const result = await drainQueueForAgent(agent._id);
    if (result.assigned) totalAssigned++;
  }
  return totalAssigned;
}

module.exports = { drainQueueForAgent, drainQueueForAllAvailableAgents };
